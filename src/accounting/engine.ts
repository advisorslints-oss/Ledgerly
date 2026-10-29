import type { LedgerDB } from '../db/database'
import type { Account, Company, EntrySource, JournalEntry, JournalLine } from '../db/types'
import { isISODate, today } from '../lib/dates'
import { getDeviceId, newId } from '../lib/id'
import { AccountingError } from './errors'

export interface LineInput {
  accountId: string
  debit?: number
  credit?: number
  description?: string
}

export interface EntryInput {
  companyId: string
  date: string
  memo?: string
  reference?: string
  lines: LineInput[]
}

export interface CleanLine {
  accountId: string
  debit: number
  credit: number
  description?: string
}

export interface EntryCheck {
  ok: boolean
  errors: string[]
  lines: CleanLine[]
  totalDebit: number
  totalCredit: number
  /** Debits minus credits; zero when balanced. */
  difference: number
}

export function isDebitNormal(type: Account['type']): boolean {
  return type === 'asset' || type === 'expense'
}

function isBlank(line: LineInput): boolean {
  return !line.accountId && !line.debit && !line.credit && !line.description?.trim()
}

/** Validates entry lines without touching the database. Blank lines (e.g. empty form rows) are ignored. */
export function checkEntry(
  lines: LineInput[],
  accounts: ReadonlyMap<string, Account>,
  companyId: string,
  opts: { allowArchived?: boolean } = {},
): EntryCheck {
  const errors: string[] = []
  const clean: CleanLine[] = []
  let totalDebit = 0
  let totalCredit = 0

  lines.forEach((line, i) => {
    if (isBlank(line)) return
    const n = i + 1
    const debit = line.debit ?? 0
    const credit = line.credit ?? 0
    const account = line.accountId ? accounts.get(line.accountId) : undefined

    if (!line.accountId) errors.push(`Line ${n}: choose an account.`)
    else if (!account || account.companyId !== companyId) errors.push(`Line ${n}: account not found.`)
    else if (account.archived && !opts.allowArchived) errors.push(`Line ${n}: "${account.name}" is archived.`)

    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit < 0 || credit < 0) {
      errors.push(`Line ${n}: amounts must be positive numbers.`)
      return
    }
    if (debit > 0 && credit > 0) errors.push(`Line ${n}: enter a debit or a credit, not both.`)
    else if (debit === 0 && credit === 0) errors.push(`Line ${n}: enter an amount.`)

    totalDebit += debit
    totalCredit += credit
    clean.push({ accountId: line.accountId, debit, credit, description: line.description?.trim() || undefined })
  })

  if (clean.length < 2) errors.push('An entry needs at least two lines.')
  const difference = totalDebit - totalCredit
  if (difference !== 0) errors.push("Debits and credits don't balance.")
  else if (clean.length >= 2 && totalDebit === 0) errors.push('The entry total must be more than zero.')

  return { ok: errors.length === 0, errors, lines: clean, totalDebit, totalCredit, difference }
}

export function assertOpenPeriod(company: Company, date: string): void {
  if (!isISODate(date)) throw new AccountingError('Enter a valid date.')
  if (company.lockDate && date <= company.lockDate) {
    throw new AccountingError(
      `The books are locked up to ${company.lockDate}. Use a later date, or change the lock date in Settings.`,
      'locked',
    )
  }
}

export async function requireCompany(db: LedgerDB, companyId: string): Promise<Company> {
  const company = await db.companies.get(companyId)
  if (!company) throw new AccountingError('Company not found.', 'not_found')
  return company
}

async function accountMap(db: LedgerDB, lines: LineInput[]): Promise<Map<string, Account>> {
  const ids = [...new Set(lines.map((l) => l.accountId).filter(Boolean))]
  const found = await db.accounts.bulkGet(ids)
  return new Map(found.filter((a): a is Account => !!a).map((a) => [a.id, a]))
}

interface InsertInput {
  date: string
  memo: string
  reference?: string
  source: EntrySource
  reversalOfId?: string
  lines: CleanLine[]
}

/** Writes an already-validated entry. Must run inside `db.write`. */
async function insertEntry(db: LedgerDB, companyId: string, input: InsertInput): Promise<JournalEntry> {
  const company = await requireCompany(db, companyId)
  const at = Date.now()
  const seq = company.nextNumbers.journal
  await db.companies.update(company.id, { nextNumbers: { ...company.nextNumbers, journal: seq + 1 }, updatedAt: at })

  const entry: JournalEntry = {
    id: newId(),
    companyId,
    number: `JE-${String(seq).padStart(4, '0')}`,
    date: input.date,
    memo: input.memo,
    reference: input.reference || undefined,
    source: input.source,
    status: 'posted',
    reversalOfId: input.reversalOfId,
    total: input.lines.reduce((sum, l) => sum + l.debit, 0),
    deviceId: getDeviceId(),
    createdAt: at,
    updatedAt: at,
  }
  const lines: JournalLine[] = input.lines.map((l, order) => ({
    id: newId(),
    companyId,
    entryId: entry.id,
    accountId: l.accountId,
    date: entry.date,
    debit: l.debit,
    credit: l.credit,
    description: l.description,
    order,
  }))

  await db.journalEntries.add(entry)
  await db.journalLines.bulkAdd(lines)
  await db.track('companies', company.id)
  await db.track('journalEntries', entry.id)
  await db.track('journalLines', lines.map((l) => l.id))
  return entry
}

export async function postEntry(db: LedgerDB, input: EntryInput): Promise<JournalEntry> {
  return db.write(async () => {
    const company = await requireCompany(db, input.companyId)
    assertOpenPeriod(company, input.date)
    const check = checkEntry(input.lines, await accountMap(db, input.lines), company.id)
    if (!check.ok) throw new AccountingError(check.errors[0])

    const memo = input.memo?.trim() ?? ''
    const entry = await insertEntry(db, company.id, {
      date: input.date,
      memo,
      reference: input.reference?.trim(),
      source: 'manual',
      lines: check.lines,
    })
    await db.logAudit(company.id, 'post', 'journalEntry', entry.id, `Posted ${entry.number}${memo ? ` · ${memo}` : ''}`)
    return entry
  })
}

/**
 * Cancels a posted entry by posting its mirror image. The original stays in the books untouched,
 * so the history of what happened is never lost.
 */
export async function reverseEntry(db: LedgerDB, entryId: string, date = today()): Promise<JournalEntry> {
  return db.write(async () => {
    const entry = await db.journalEntries.get(entryId)
    if (!entry) throw new AccountingError('Entry not found.', 'not_found')
    if (entry.status === 'reversed') throw new AccountingError('This entry has already been reversed.', 'conflict')
    if (entry.source === 'reversal') {
      throw new AccountingError("A reversal can't be reversed. Post a new entry instead.", 'conflict')
    }
    const company = await requireCompany(db, entry.companyId)
    if (date < entry.date) throw new AccountingError("The reversal date can't be before the original entry's date.")
    assertOpenPeriod(company, date)

    const lines = await db.journalLines.where('entryId').equals(entryId).sortBy('order')
    const reversal = await insertEntry(db, company.id, {
      date,
      memo: `Reversal of ${entry.number}${entry.memo ? ` · ${entry.memo}` : ''}`,
      reference: entry.reference,
      source: 'reversal',
      reversalOfId: entry.id,
      lines: lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, description: l.description })),
    })
    await db.journalEntries.update(entry.id, { status: 'reversed', reversedById: reversal.id, updatedAt: Date.now() })
    await db.track('journalEntries', entry.id)
    await db.logAudit(company.id, 'reverse', 'journalEntry', entry.id, `Reversed ${entry.number} with ${reversal.number}`)
    return reversal
  })
}

export interface OpeningAmount {
  accountId: string
  /** In the account's normal direction: positive means a normal balance (e.g. money in the bank). */
  amount: number
}

/**
 * Replaces the company's opening balances with a single entry dated `date`. Any difference between
 * debits and credits goes to the Opening Balance Equity account.
 */
export async function setOpeningBalances(
  db: LedgerDB,
  companyId: string,
  date: string,
  amounts: OpeningAmount[],
): Promise<JournalEntry | null> {
  return db.write(async () => {
    const company = await requireCompany(db, companyId)
    assertOpenPeriod(company, date)

    const previous = await db.journalEntries
      .where('companyId')
      .equals(companyId)
      .filter((e) => e.source === 'opening' && e.status === 'posted')
      .toArray()
    for (const entry of previous) await reverseEntry(db, entry.id, entry.date > date ? entry.date : date)

    const offset = await db.accounts.where('[companyId+systemKey]').equals([companyId, 'opening_balance']).first()
    if (!offset) throw new AccountingError('The Opening Balance Equity account is missing.', 'not_found')

    const accounts = await accountMap(
      db,
      amounts.map((a) => ({ accountId: a.accountId })),
    )
    const lines: CleanLine[] = []
    for (const { accountId, amount } of amounts) {
      if (!amount) continue
      const account = accounts.get(accountId)
      if (!account || account.companyId !== companyId) throw new AccountingError('Account not found.', 'not_found')
      if (!Number.isSafeInteger(amount)) throw new AccountingError(`Invalid amount for ${account.name}.`)
      const debitSide = isDebitNormal(account.type) === amount > 0
      lines.push({ accountId, debit: debitSide ? Math.abs(amount) : 0, credit: debitSide ? 0 : Math.abs(amount) })
    }
    if (lines.length === 0) return null

    const diff = lines.reduce((s, l) => s + l.debit - l.credit, 0)
    if (diff !== 0) lines.push({ accountId: offset.id, debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0 })

    const entry = await insertEntry(db, companyId, { date, memo: 'Opening balances', source: 'opening', lines })
    await db.logAudit(companyId, 'post', 'journalEntry', entry.id, `Set opening balances as of ${date}`)
    return entry
  })
}
