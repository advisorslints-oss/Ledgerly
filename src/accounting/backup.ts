import type { LedgerDB } from '../db/database'
import type { Account, AuditEvent, Company, JournalEntry, JournalLine, TaxRate } from '../db/types'
import { AccountingError } from './errors'

export interface BackupFile {
  format: 'ledgerly-backup'
  version: 1
  exportedAt: string
  company: Company
  accounts: Account[]
  journalEntries: JournalEntry[]
  journalLines: JournalLine[]
  taxRates: TaxRate[]
  audit: AuditEvent[]
}

export async function exportCompany(db: LedgerDB, companyId: string): Promise<BackupFile> {
  return db.write(async () => {
    const company = await db.companies.get(companyId)
    if (!company) throw new AccountingError('Company not found.', 'not_found')
    const at = Date.now()
    await db.companies.update(companyId, { lastBackupAt: at })
    return {
      format: 'ledgerly-backup',
      version: 1,
      exportedAt: new Date(at).toISOString(),
      company: { ...company, lastBackupAt: at },
      accounts: await db.accounts.where('companyId').equals(companyId).toArray(),
      journalEntries: await db.journalEntries.where('companyId').equals(companyId).toArray(),
      journalLines: await db.journalLines.where('companyId').equals(companyId).toArray(),
      taxRates: await db.taxRates.where('companyId').equals(companyId).toArray(),
      audit: await db.audit.where('[companyId+at]').between([companyId, 0], [companyId, Infinity]).toArray(),
    }
  })
}

/** Parses and sanity-checks a backup, including that every entry still balances. */
export function parseBackup(text: string): BackupFile {
  let data: BackupFile
  try {
    data = JSON.parse(text)
  } catch {
    throw new AccountingError("This file isn't a Ledgerly backup.")
  }
  if (data?.format !== 'ledgerly-backup' || data.version !== 1 || !data.company?.id) {
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
  await db.write(async () => {
    for (const table of [db.accounts, db.journalEntries, db.journalLines, db.taxRates] as const) {
      await table.where('companyId').equals(id).delete()
    }
    await db.audit.where('[companyId+at]').between([id, 0], [id, Infinity]).delete()
    await db.companies.put(backup.company)
    await db.accounts.bulkPut(backup.accounts)
    await db.journalEntries.bulkPut(backup.journalEntries)
    await db.journalLines.bulkPut(backup.journalLines)
    await db.taxRates.bulkPut(backup.taxRates)
    await db.audit.bulkPut(backup.audit)
    await db.track('companies', id)
    await db.logAudit(id, 'restore', 'company', id, `Restored from a backup made ${backup.exportedAt.slice(0, 10)}`)
  })
}
