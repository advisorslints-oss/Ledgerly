import type { LedgerDB } from '../db/database'
import type { Account, AccountSubtype, AccountType } from '../db/types'
import { newId } from '../lib/id'
import { AccountingError } from './errors'

export const TYPE_LABELS: Record<AccountType, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
}

export const TYPE_HELP: Record<AccountType, string> = {
  asset: 'What the business owns or is owed: cash, bank, stock, equipment.',
  liability: 'What the business owes: suppliers, loans, taxes due.',
  equity: "The owners' stake: money put in plus profits kept.",
  income: 'Money earned from sales and other sources.',
  expense: 'Costs of running the business.',
}

export const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense']

interface SubtypeInfo {
  id: AccountSubtype
  label: string
  type: AccountType
  /** Code range used to suggest a code for new accounts. */
  range: [number, number]
}

export const SUBTYPES: SubtypeInfo[] = [
  { id: 'cash', label: 'Cash', type: 'asset', range: [1000, 1009] },
  { id: 'bank', label: 'Bank', type: 'asset', range: [1010, 1099] },
  { id: 'receivable', label: 'Receivable', type: 'asset', range: [1100, 1199] },
  { id: 'inventory', label: 'Inventory', type: 'asset', range: [1200, 1299] },
  { id: 'current_asset', label: 'Other current asset', type: 'asset', range: [1300, 1349] },
  { id: 'tax_receivable', label: 'Tax receivable', type: 'asset', range: [1350, 1399] },
  { id: 'fixed_asset', label: 'Fixed asset', type: 'asset', range: [1500, 1799] },
  { id: 'other_asset', label: 'Other asset', type: 'asset', range: [1800, 1999] },
  { id: 'payable', label: 'Payable', type: 'liability', range: [2000, 2099] },
  { id: 'credit_card', label: 'Credit card', type: 'liability', range: [2100, 2199] },
  { id: 'tax_payable', label: 'Tax payable', type: 'liability', range: [2200, 2299] },
  { id: 'current_liability', label: 'Other current liability', type: 'liability', range: [2300, 2499] },
  { id: 'long_term_liability', label: 'Long-term liability', type: 'liability', range: [2500, 2999] },
  { id: 'equity', label: 'Equity', type: 'equity', range: [3000, 3899] },
  { id: 'retained_earnings', label: 'Retained earnings', type: 'equity', range: [3900, 3949] },
  { id: 'sales', label: 'Sales', type: 'income', range: [4000, 4899] },
  { id: 'other_income', label: 'Other income', type: 'income', range: [4900, 4999] },
  { id: 'cost_of_sales', label: 'Cost of sales', type: 'expense', range: [5000, 5999] },
  { id: 'operating_expense', label: 'Operating expense', type: 'expense', range: [6000, 6999] },
  { id: 'other_expense', label: 'Other expense', type: 'expense', range: [7000, 7999] },
]

export function subtypeInfo(id: AccountSubtype): SubtypeInfo {
  return SUBTYPES.find((s) => s.id === id)!
}

export function subtypesFor(type: AccountType): SubtypeInfo[] {
  return SUBTYPES.filter((s) => s.type === type)
}

/** Suggests the next free code in the subtype's range, stepping by 10 where there's room. */
export function suggestCode(existing: Pick<Account, 'code'>[], subtype: AccountSubtype): string {
  const [start, end] = subtypeInfo(subtype).range
  const used = new Set(existing.map((a) => a.code))
  const inRange = existing.map((a) => Number(a.code)).filter((n) => Number.isInteger(n) && n >= start && n <= end)
  let next = inRange.length ? Math.max(...inRange) + 10 : start
  if (next > end) next = start
  for (let n = next; n <= end; n++) if (!used.has(String(n))) return String(n)
  for (let n = start; n <= end; n++) if (!used.has(String(n))) return String(n)
  return ''
}

export interface AccountInput {
  code: string
  name: string
  type: AccountType
  subtype: AccountSubtype
  description?: string
}

async function validate(db: LedgerDB, companyId: string, input: AccountInput, selfId?: string): Promise<AccountInput> {
  const name = input.name.trim()
  const code = input.code.trim()
  if (!name) throw new AccountingError('Enter an account name.')
  if (name.length > 120) throw new AccountingError('Keep the name under 120 characters.')
  if (!/^[A-Za-z0-9.\-]{1,20}$/.test(code)) {
    throw new AccountingError('Use up to 20 letters, numbers, dots or dashes for the code.')
  }
  if (subtypeInfo(input.subtype)?.type !== input.type) throw new AccountingError('Choose a detail type that matches the account type.')

  const siblings = await db.accounts.where('companyId').equals(companyId).toArray()
  const lower = name.toLowerCase()
  if (siblings.some((a) => a.id !== selfId && a.code.toLowerCase() === code.toLowerCase())) {
    throw new AccountingError(`Code ${code} is already used by another account.`, 'conflict')
  }
  if (siblings.some((a) => a.id !== selfId && a.name.toLowerCase() === lower)) {
    throw new AccountingError(`There's already an account called "${name}".`, 'conflict')
  }
  return { ...input, name, code, description: input.description?.trim() || undefined }
}

export async function createAccount(db: LedgerDB, companyId: string, input: AccountInput): Promise<Account> {
  return db.write(async () => {
    const clean = await validate(db, companyId, input)
    const at = Date.now()
    const account: Account = { id: newId(), companyId, ...clean, archived: false, createdAt: at, updatedAt: at }
    await db.accounts.add(account)
    await db.track(companyId, 'accounts', account.id)
    await db.logAudit(companyId, 'create', 'account', account.id, `Created account ${account.code} ${account.name}`)
    return account
  })
}

export async function accountHasActivity(db: LedgerDB, accountId: string): Promise<boolean> {
  return (await db.journalLines.where('[accountId+date]').between([accountId, ''], [accountId, '￿']).count()) > 0
}

export async function updateAccount(db: LedgerDB, id: string, input: AccountInput): Promise<Account> {
  return db.write(async () => {
    const current = await db.accounts.get(id)
    if (!current) throw new AccountingError('Account not found.', 'not_found')
    const clean = await validate(db, current.companyId, input, id)

    if (clean.type !== current.type) {
      if (current.systemKey) throw new AccountingError("This account is used by the app, so its type can't change.")
      if (await accountHasActivity(db, id)) {
        throw new AccountingError("This account has transactions, so its type can't change. Create a new account instead.")
      }
    }
    if (current.systemKey && clean.subtype !== current.subtype) {
      throw new AccountingError("This account is used by the app, so its detail type can't change.")
    }

    const updated: Account = { ...current, ...clean, updatedAt: Date.now() }
    await db.accounts.put(updated)
    await db.track(current.companyId, 'accounts', id, { fields: ['code', 'name', 'type', 'subtype', 'description', 'updatedAt'] })
    await db.logAudit(current.companyId, 'update', 'account', id, `Updated account ${updated.code} ${updated.name}`)
    return updated
  })
}

export async function setAccountArchived(db: LedgerDB, id: string, archived: boolean): Promise<void> {
  await db.write(async () => {
    const current = await db.accounts.get(id)
    if (!current) throw new AccountingError('Account not found.', 'not_found')
    if (archived && current.systemKey) throw new AccountingError("This account is used by the app and can't be archived.")
    await db.accounts.update(id, { archived, updatedAt: Date.now() })
    await db.track(current.companyId, 'accounts', id, { fields: ['archived', 'updatedAt'] })
    await db.logAudit(
      current.companyId,
      archived ? 'archive' : 'restore',
      'account',
      id,
      `${archived ? 'Archived' : 'Restored'} account ${current.code} ${current.name}`,
    )
  })
}

export async function deleteAccount(db: LedgerDB, id: string): Promise<void> {
  await db.write(async () => {
    const current = await db.accounts.get(id)
    if (!current) return
    if (current.systemKey) throw new AccountingError("This account is used by the app and can't be deleted.")
    if (await accountHasActivity(db, id)) {
      throw new AccountingError('This account has transactions. Archive it instead to hide it.', 'conflict')
    }
    const taxUse = await db.taxRates
      .where('companyId')
      .equals(current.companyId)
      .filter((t) => t.components.some((c) => c.salesAccountId === id || c.purchaseAccountId === id))
      .count()
    if (taxUse) throw new AccountingError('A tax rate uses this account. Change the tax rate first.', 'conflict')
    const itemUse = await db.items
      .where('companyId')
      .equals(current.companyId)
      .filter((i) => [i.salesAccountId, i.purchaseAccountId, i.inventoryAccountId].includes(id))
      .count()
    if (itemUse) throw new AccountingError('A product or service uses this account. Change it first.', 'conflict')

    await db.accounts.delete(id)
    await db.track(current.companyId, 'accounts', id, { op: 'delete' })
    await db.logAudit(current.companyId, 'delete', 'account', id, `Deleted account ${current.code} ${current.name}`)
  })
}
