import Dexie, { type EntityTable, type Transaction } from 'dexie'
import { AccountingError } from '../accounting/errors'
import { getDeviceId, newId } from '../lib/id'
import type {
  Account,
  Attachment,
  AuditEvent,
  BankLine,
  BankRule,
  ChangeRecord,
  Company,
  Contact,
  Doc,
  Item,
  JournalEntry,
  JournalLine,
  MetaRecord,
  Payment,
  Reconciliation,
  StockMove,
  TaxRate,
} from './types'

/** Tables whose rows belong to a company and have a companyId index. */
export const COMPANY_TABLES = [
  'accounts',
  'journalEntries',
  'journalLines',
  'taxRates',
  'contacts',
  'items',
  'documents',
  'payments',
  'stockMoves',
  'bankLines',
  'bankRules',
  'reconciliations',
  'attachments',
] as const
export type CompanyTable = (typeof COMPANY_TABLES)[number]

type BatchedTransaction = Transaction & { batchId?: string; parent?: BatchedTransaction }

export class LedgerDB extends Dexie {
  companies!: EntityTable<Company, 'id'>
  accounts!: EntityTable<Account, 'id'>
  journalEntries!: EntityTable<JournalEntry, 'id'>
  journalLines!: EntityTable<JournalLine, 'id'>
  taxRates!: EntityTable<TaxRate, 'id'>
  contacts!: EntityTable<Contact, 'id'>
  items!: EntityTable<Item, 'id'>
  documents!: EntityTable<Doc, 'id'>
  payments!: EntityTable<Payment, 'id'>
  stockMoves!: EntityTable<StockMove, 'id'>
  bankLines!: EntityTable<BankLine, 'id'>
  bankRules!: EntityTable<BankRule, 'id'>
  reconciliations!: EntityTable<Reconciliation, 'id'>
  attachments!: EntityTable<Attachment, 'id'>
  audit!: EntityTable<AuditEvent, 'id'>
  changes!: EntityTable<ChangeRecord, 'seq'>
  meta!: EntityTable<MetaRecord, 'key'>

  readonly deviceId: string
  /** Businesses this person can only view (a viewer on a shared business). Saves to them are refused. */
  readOnlyCompanies = new Set<string>()
  private writeListeners = new Set<() => void>()

  constructor(name = 'ledgerly', deviceId?: string) {
    super(name)
    this.deviceId = deviceId ?? getDeviceId()
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
    this.version(2)
      .stores({
        journalEntries: 'id, companyId, [companyId+date], [companyId+number], docId',
        changes: '++seq, at, companyId',
        contacts: 'id, companyId',
        items: 'id, companyId',
        documents: 'id, companyId, [companyId+type], contactId',
        payments: 'id, companyId, contactId',
        stockMoves: 'id, companyId, itemId, sourceId',
        bankLines: 'id, companyId, [accountId+date]',
        bankRules: 'id, companyId',
        reconciliations: 'id, companyId, accountId',
        attachments: 'id, companyId, parentId',
      })
      // Outbox rows from version 1 have no batch or company; nothing had synced yet, so start clean.
      .upgrade((tx) => tx.table('changes').clear())
  }

  /**
   * Runs `fn` in one read-write transaction over every table, so a save and its audit trail land
   * together. Every change made inside shares one sync batch.
   */
  write<T>(fn: () => Promise<T>): Promise<T> {
    const outermost = !Dexie.currentTransaction
    // The scope must be a real async function: Dexie only keeps the transaction alive across native awaits then.
    const result = this.transaction('rw', this.tables, async () => {
      const tx = Dexie.currentTransaction as BatchedTransaction
      if (!batchOf(tx)) tx.batchId = newId()
      return fn()
    })
    if (outermost) result.then(() => this.writeListeners.forEach((l) => l()), () => {})
    return result
  }

  /** Called after each completed save, e.g. to trigger a sync. */
  onWrite(listener: () => void): () => void {
    this.writeListeners.add(listener)
    return () => this.writeListeners.delete(listener)
  }

  /** Records changed rows in the outbox. Must run inside `write`, after the rows are saved. */
  async track(companyId: string, table: string, keys: string | string[], opts: { op?: 'put' | 'delete'; fields?: string[] } = {}): Promise<void> {
    // Every save passes through here, so this is the one place view-only access is enforced on the device.
    if (this.readOnlyCompanies.has(companyId)) throw new AccountingError('You have view-only access to this business.', 'conflict')
    const op = opts.op ?? 'put'
    const list = Array.isArray(keys) ? keys : [keys]
    if (!list.length) return
    const batch = batchOf(Dexie.currentTransaction as BatchedTransaction) ?? newId()
    // Attachments carry binary files that sync separately, so the outbox only notes that they changed.
    const rows = op === 'put' && table !== 'attachments' ? await this.table(table).bulkGet(list) : []
    const at = Date.now()
    await this.changes.bulkAdd(
      list.map((key, i) => ({ batch, companyId, table, key, op, fields: opts.fields, data: rows[i], at, deviceId: this.deviceId })),
    )
  }

  async logAudit(companyId: string, action: string, entity: string, entityId: string, summary: string): Promise<void> {
    const event: AuditEvent = { id: newId(), companyId, at: Date.now(), action, entity, entityId, summary, deviceId: this.deviceId }
    await this.audit.add(event)
    await this.track(companyId, 'audit', event.id)
  }
}

function batchOf(tx: BatchedTransaction | null): string | undefined {
  for (let t: BatchedTransaction | undefined = tx ?? undefined; t; t = t.parent) if (t.batchId) return t.batchId
  return undefined
}
