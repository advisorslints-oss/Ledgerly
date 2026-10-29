import Dexie, { type EntityTable } from 'dexie'
import { getDeviceId, newId } from '../lib/id'
import type {
  Account,
  AuditEvent,
  ChangeRecord,
  Company,
  JournalEntry,
  JournalLine,
  MetaRecord,
  TaxRate,
} from './types'

export class LedgerDB extends Dexie {
  companies!: EntityTable<Company, 'id'>
  accounts!: EntityTable<Account, 'id'>
  journalEntries!: EntityTable<JournalEntry, 'id'>
  journalLines!: EntityTable<JournalLine, 'id'>
  taxRates!: EntityTable<TaxRate, 'id'>
  audit!: EntityTable<AuditEvent, 'id'>
  changes!: EntityTable<ChangeRecord, 'seq'>
  meta!: EntityTable<MetaRecord, 'key'>

  constructor(name = 'ledgerly') {
    super(name)
    this.version(1).stores({
      companies: 'id, name',
      accounts: 'id, companyId, [companyId+code], [companyId+systemKey]',
      journalEntries: 'id, companyId, [companyId+date], [companyId+number]',
      journalLines: 'id, companyId, entryId, [companyId+date], [accountId+date]',
      taxRates: 'id, companyId',
      audit: 'id, [companyId+at]',
      changes: '++seq, at',
      meta: 'key',
    })
  }

  /** Runs `fn` in one read-write transaction over every table, so a write and its audit trail land together. */
  write<T>(fn: () => Promise<T>): Promise<T> {
    return this.transaction('rw', this.tables, fn)
  }

  async track(table: string, keys: string | string[], op: ChangeRecord['op'] = 'put'): Promise<void> {
    const at = Date.now()
    const deviceId = getDeviceId()
    const list = Array.isArray(keys) ? keys : [keys]
    await this.changes.bulkAdd(list.map((key) => ({ table, key, op, at, deviceId })))
  }

  async logAudit(companyId: string, action: string, entity: string, entityId: string, summary: string): Promise<void> {
    await this.audit.add({ id: newId(), companyId, at: Date.now(), action, entity, entityId, summary, deviceId: getDeviceId() })
  }
}
