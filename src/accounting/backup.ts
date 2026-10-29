import { COMPANY_TABLES, type LedgerDB } from '../db/database'
import type {
  Account,
  Attachment,
  AuditEvent,
  BankLine,
  BankRule,
  Company,
  Contact,
  Doc,
  Item,
  JournalEntry,
  JournalLine,
  Payment,
  Reconciliation,
  Recurring,
  Reminder,
  StockMove,
  TaxRate,
} from '../db/types'
import { AccountingError } from './errors'

type StoredAttachment = Omit<Attachment, 'data'> & { data: string }

export interface BackupFile {
  format: 'ledgerly-backup'
  version: 1 | 2
  exportedAt: string
  company: Company
  accounts: Account[]
  journalEntries: JournalEntry[]
  journalLines: JournalLine[]
  taxRates: TaxRate[]
  audit: AuditEvent[]
  contacts?: Contact[]
  items?: Item[]
  documents?: Doc[]
  payments?: Payment[]
  stockMoves?: StockMove[]
  bankLines?: BankLine[]
  bankRules?: BankRule[]
  reconciliations?: Reconciliation[]
  recurring?: Recurring[]
  reminders?: Reminder[]
  attachments?: StoredAttachment[]
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function base64ToBlob(data: string, type: string): Blob {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

export async function exportCompany(db: LedgerDB, companyId: string): Promise<BackupFile> {
  const data = await db.write(async () => {
    const company = await db.companies.get(companyId)
    if (!company) throw new AccountingError('Company not found.', 'not_found')
    const at = Date.now()
    await db.companies.update(companyId, { lastBackupAt: at })
    await db.track(companyId, 'companies', companyId, { fields: ['lastBackupAt'] })
    const rows = Object.fromEntries(
      await Promise.all(COMPANY_TABLES.map(async (t) => [t, await db.table(t).where('companyId').equals(companyId).toArray()] as const)),
    )
    return {
      company: { ...company, lastBackupAt: at },
      at,
      rows,
      audit: await db.audit.where('[companyId+at]').between([companyId, 0], [companyId, Infinity]).toArray(),
    }
  })
  const attachments = await Promise.all(
    (data.rows.attachments as Attachment[]).map(async (a) => ({ ...a, data: await blobToBase64(a.data) })),
  )
  return {
    format: 'ledgerly-backup',
    version: 2,
    exportedAt: new Date(data.at).toISOString(),
    company: data.company,
    accounts: data.rows.accounts,
    journalEntries: data.rows.journalEntries,
    journalLines: data.rows.journalLines,
    taxRates: data.rows.taxRates,
    audit: data.audit,
    contacts: data.rows.contacts,
    items: data.rows.items,
    documents: data.rows.documents,
    payments: data.rows.payments,
    stockMoves: data.rows.stockMoves,
    bankLines: data.rows.bankLines,
    bankRules: data.rows.bankRules,
    reconciliations: data.rows.reconciliations,
    recurring: data.rows.recurring,
    reminders: data.rows.reminders,
    attachments,
  }
}

/** Parses and sanity-checks a backup, including that every entry still balances. */
export function parseBackup(text: string): BackupFile {
  let data: BackupFile
  try {
    data = JSON.parse(text)
  } catch {
    throw new AccountingError("This file isn't a Ledgerly backup.")
  }
  if (data?.format !== 'ledgerly-backup' || (data.version !== 1 && data.version !== 2) || !data.company?.id) {
    throw new AccountingError("This file isn't a Ledgerly backup, or it's from a newer version.")
  }
  for (const key of ['accounts', 'journalEntries', 'journalLines', 'taxRates', 'audit'] as const) {
    if (!Array.isArray(data[key])) throw new AccountingError('The backup file is incomplete.')
  }
  const companyId = data.company.id
  const accountIds = new Set(data.accounts.map((a) => a.id))
  const sums = new Map<string, number>()
  for (const line of data.journalLines) {
    if (line.companyId !== companyId || !accountIds.has(line.accountId)) {
      throw new AccountingError('The backup file is damaged: a transaction points to a missing account.')
    }
    sums.set(line.entryId, (sums.get(line.entryId) ?? 0) + line.debit - line.credit)
  }
  for (const entry of data.journalEntries) {
    if (sums.get(entry.id)) throw new AccountingError(`The backup file is damaged: ${entry.number} doesn't balance.`)
  }
  return data
}

/** Restores a backup, replacing that company's data on this device if it already exists. */
export async function restoreBackup(db: LedgerDB, backup: BackupFile): Promise<void> {
  const id = backup.company.id
  const attachments: Attachment[] = (backup.attachments ?? []).map((a) => ({ ...a, data: base64ToBlob(a.data, a.type) }))
  const rows: Record<(typeof COMPANY_TABLES)[number], unknown[]> = {
    accounts: backup.accounts,
    journalEntries: backup.journalEntries,
    journalLines: backup.journalLines,
    taxRates: backup.taxRates,
    contacts: backup.contacts ?? [],
    items: backup.items ?? [],
    documents: backup.documents ?? [],
    payments: backup.payments ?? [],
    stockMoves: backup.stockMoves ?? [],
    bankLines: backup.bankLines ?? [],
    bankRules: backup.bankRules ?? [],
    reconciliations: backup.reconciliations ?? [],
    recurring: backup.recurring ?? [],
    reminders: backup.reminders ?? [],
    attachments,
  }
  await db.transaction('rw', db.tables, async () => {
    for (const table of COMPANY_TABLES) await db.table(table).where('companyId').equals(id).delete()
    await db.audit.where('[companyId+at]').between([id, 0], [id, Infinity]).delete()
    await db.companies.put({ ...backup.company, nextNumbers: { ...backup.company.nextNumbers } })
    for (const table of COMPANY_TABLES) if (rows[table].length) await db.table(table).bulkPut(rows[table])
    await db.audit.bulkPut(backup.audit)
  })
  await db.write(() => db.logAudit(id, 'restore', 'company', id, `Restored from a backup made ${backup.exportedAt.slice(0, 10)}`))
}
