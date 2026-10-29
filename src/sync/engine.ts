import { deleteCompany } from '../accounting/company'
import { DOC_TYPES } from '../accounting/documents'
import type { LedgerDB } from '../db/database'
import type { Attachment, ChangeRecord, DocType } from '../db/types'
import { newId } from '../lib/id'
import { ApiError, type ApiClient } from './api'
import { SYNC_TABLES, type CompanyAccess, type PublicUser, type PushBatch, type Role, type ServerRecord, type SyncChange, type SyncTable } from './protocol'

export interface Session {
  token: string
  user: PublicUser
  /** Sync server address; empty means the address the app was opened from. */
  server: string
}

/** Something the server refused, kept so the person can see what didn't make it and why. */
export interface SyncIssue {
  id: string
  at: number
  companyId: string
  summary: string
  reason: string
}

export interface SyncMeta {
  session?: Session
  /** Server sequence number this device has caught up to. */
  cursor: number
  /** Businesses that sync on this device. */
  synced: string[]
  /** Account businesses deliberately removed from this device; they aren't downloaded again automatically. */
  excluded: string[]
  roles: Record<string, Role>
  access: CompanyAccess[]
  lastSyncedAt?: number
  issues: SyncIssue[]
}

const META_KEY = 'sync'
const TABLES = new Set<string>(SYNC_TABLES)
const key = (table: string, id: string) => `${table}\u0000${id}`

export async function readMeta(db: LedgerDB): Promise<SyncMeta> {
  const row = await db.meta.get(META_KEY)
  return { cursor: 0, synced: [], excluded: [], roles: {}, access: [], issues: [], ...(row?.value as Partial<SyncMeta> | undefined) }
}

export async function writeMeta(db: LedgerDB, patch: Partial<SyncMeta>): Promise<SyncMeta> {
  const next = { ...(await readMeta(db)), ...patch }
  await db.meta.put({ key: META_KEY, value: next })
  return next
}

async function pendingKeys(db: LedgerDB): Promise<Set<string>> {
  return new Set((await db.changes.toArray()).map((c) => key(c.table, c.key)))
}

/**
 * Writes records that came from the server, without adding them to the outbox. Records with local
 * changes still waiting to be sent are skipped: the device's version goes up first, and the server's
 * merged result comes back afterwards.
 */
export async function applyRecords(db: LedgerDB, api: ApiClient, records: ServerRecord[], skip = new Set<string>()): Promise<void> {
  const fresh = records.filter((r) => TABLES.has(r.tbl) && !skip.has(key(r.tbl, r.id)))
  if (!fresh.length) return
  // Fetch attachment files first: network calls can't happen inside a database transaction.
  const files = new Map<string, Blob>()
  for (const r of fresh) {
    if (r.tbl !== 'attachments' || !r.data) continue
    const local = await db.attachments.get(r.id)
    if (local && !local.missing) continue
    try {
      files.set(r.id, await api.downloadFile(r.id))
    } catch {
      // Marked as missing below and retried on the next sync.
    }
  }
  await db.transaction('rw', db.tables, async () => {
    const puts = new Map<string, unknown[]>()
    const deletes = new Map<string, string[]>()
    for (const r of fresh) {
      if (r.data === null) {
        deletes.set(r.tbl, [...(deletes.get(r.tbl) ?? []), r.id])
        continue
      }
      let row: unknown = r.data
      if (r.tbl === 'attachments') {
        const local = await db.attachments.get(r.id)
        const blob = files.get(r.id)
        row = blob ? { ...r.data, data: blob, missing: undefined } : local && !local.missing ? { ...r.data, data: local.data } : { ...r.data, data: new Blob([], { type: String(r.data.type ?? '') }), missing: true }
      }
      puts.set(r.tbl, [...(puts.get(r.tbl) ?? []), row])
    }
    for (const [tbl, ids] of deletes) await db.table(tbl).bulkDelete(ids)
    for (const [tbl, rows] of puts) await db.table(tbl).bulkPut(rows)
  })
}

/** A readable name for what a rejected batch was, e.g. "Invoice INV-0042". */
function describe(changes: SyncChange[]): string {
  const doc = changes.find((c) => c.tbl === 'documents' && c.data)?.data
  if (doc) return `${DOC_TYPES[doc.type as DocType]?.label ?? 'Document'} ${String(doc.number)}`
  const payment = changes.find((c) => c.tbl === 'payments' && c.data)?.data
  if (payment) return `Payment ${String(payment.number)}`
  const entry = changes.find((c) => c.tbl === 'journalEntries' && c.data && c.op === 'put')?.data
  if (entry) return `${String(entry.number)}${entry.memo ? ` · ${String(entry.memo)}` : ''}`
  const named = changes.find((c) => c.data && typeof c.data.name === 'string')?.data
  if (named) return String(named.name)
  return 'A change'
}

/** Groups outbox rows into one batch per save, keeping only the latest copy of each record. */
async function buildBatches(db: LedgerDB, api: ApiClient, rows: ChangeRecord[]): Promise<PushBatch[]> {
  const groups = new Map<string, ChangeRecord[]>()
  for (const r of rows) groups.set(r.batch, [...(groups.get(r.batch) ?? []), r])
  const batches: PushBatch[] = []
  for (const [id, list] of groups) {
    const changes = new Map<string, SyncChange>()
    for (const c of list) {
      if (!TABLES.has(c.table) || (c.table === 'companies' && c.op === 'delete')) continue
      const k = key(c.table, c.key)
      if (c.op === 'delete') {
        changes.set(k, { tbl: c.table as SyncTable, id: c.key, op: 'delete' })
        continue
      }
      let data = c.data as Record<string, unknown> | undefined
      if (c.table === 'attachments') {
        const file = await db.attachments.get(c.key)
        if (!file || file.missing) continue
        await api.uploadFile(file.id, file.companyId, file.data)
        const { data: _blob, missing: _missing, ...meta } = file
        data = meta
      }
      if (!data) continue
      const prev = changes.get(k)
      const fields = prev?.op === 'put' && prev.fields && c.fields ? [...new Set([...prev.fields, ...c.fields])] : prev ? undefined : c.fields
      changes.set(k, { tbl: c.table as SyncTable, id: c.key, op: 'put', data, fields })
    }
    if (changes.size) batches.push({ id, companyId: list[0].companyId, changes: [...changes.values()] })
  }
  return batches
}

const PAGE = 2000

/** Sends saved changes for syncing businesses. Returns what the server refused (already undone locally). */
export async function pushChanges(db: LedgerDB, api: ApiClient, meta: SyncMeta): Promise<SyncIssue[]> {
  const synced = new Set(meta.synced)
  const issues: SyncIssue[] = []
  for (let round = 0; round < 100; round++) {
    const rows = await db.changes.orderBy('seq').limit(PAGE).toArray()
    if (!rows.length) break
    // Businesses that don't sync on this device don't need an outbox; they upload in full if sync is turned on.
    const localOnly = rows.filter((r) => !synced.has(r.companyId)).map((r) => r.seq!)
    if (localOnly.length) await db.changes.bulkDelete(localOnly)
    const mine = rows.filter((r) => synced.has(r.companyId))
    if (mine.length) {
      const batches = await buildBatches(db, api, mine)
      const res = batches.length ? await api.push({ deviceId: db.deviceId, batches }) : { results: [] }
      await db.changes.bulkDelete(mine.map((r) => r.seq!))

      // Later batches win: a record changed by several saves takes the server's answer to the last one.
      const apply = new Map<string, ServerRecord>()
      for (const result of res.results) {
        const sent = batches.find((b) => b.id === result.batchId)!
        for (const c of sent.changes) apply.delete(key(c.tbl, c.id))
        for (const r of result.ok ? result.rewritten : result.current) apply.set(key(r.tbl, r.id), r)
        if (!result.ok) issues.push({ id: newId(), at: Date.now(), companyId: sent.companyId, summary: describe(sent.changes), reason: result.reason })
      }
      // Rejected new records come back as "null", which removes them from this device.
      await applyRecords(db, api, [...apply.values()], await pendingKeys(db))
    }
    if (rows.length < PAGE) break
  }
  return issues
}

/** Fetches everything changed on other devices since this device last synced. */
export async function pullChanges(db: LedgerDB, api: ApiClient, meta: SyncMeta): Promise<{ meta: SyncMeta; issues: SyncIssue[] }> {
  let cursor = meta.cursor
  let access: CompanyAccess[] = meta.access
  let deleted: string[] = []
  const synced = new Set(meta.synced)
  for (let page = 0; page < 500; page++) {
    const res = await api.pull(cursor, db.deviceId)
    access = res.companies
    deleted = res.deletedCompanies
    const relevant = res.changes.filter((c) => synced.has(c.companyId))
    if (relevant.length) await applyRecords(db, api, relevant, await pendingKeys(db))
    cursor = res.cursor
    if (!res.more) break
  }

  const issues: SyncIssue[] = []
  const issue = (companyId: string, summary: string, reason: string) => issues.push({ id: newId(), at: Date.now(), companyId, summary, reason })
  for (const id of deleted) {
    if (!synced.has(id)) continue
    const name = (await db.companies.get(id))?.name ?? 'A business'
    await deleteCompany(db, id)
    synced.delete(id)
    issue(id, name, 'Its owner deleted it from the account, so it was removed from this device.')
  }
  for (const id of [...synced]) {
    if (access.some((a) => a.id === id) || deleted.includes(id)) continue
    synced.delete(id)
    issue(id, (await db.companies.get(id))?.name ?? 'A business', "You no longer have access to it. It stays on this device but won't sync.")
  }
  // Businesses created on another device or shared with you arrive in full.
  for (const a of access) {
    if (synced.has(a.id) || meta.excluded.includes(a.id) || (await db.companies.get(a.id))) continue
    await downloadCompany(db, api, a.id)
    synced.add(a.id)
  }

  const next = await writeMeta(db, { cursor, access, synced: [...synced], roles: Object.fromEntries(access.map((a) => [a.id, a.role])), lastSyncedAt: Date.now() })
  return { meta: next, issues }
}

/** Retries attachment files that couldn't be downloaded earlier. */
async function fetchMissingFiles(db: LedgerDB, api: ApiClient, synced: string[]): Promise<void> {
  const missing = (await db.attachments.toArray()).filter((a) => a.missing && synced.includes(a.companyId))
  for (const a of missing) {
    try {
      const data = await api.downloadFile(a.id)
      await db.attachments.update(a.id, { data, missing: undefined })
    } catch {
      // Try again next time.
    }
  }
}

/** One full round: send local changes, then catch up with everyone else's. */
export async function syncOnce(db: LedgerDB, api: ApiClient): Promise<SyncMeta> {
  let meta = await readMeta(db)
  if (!meta.session) return meta
  const pushed = await pushChanges(db, api, meta)
  const pulled = await pullChanges(db, api, meta)
  meta = pulled.meta
  await fetchMissingFiles(db, api, meta.synced)
  const issues = [...pushed, ...pulled.issues]
  return issues.length ? writeMeta(db, { issues: [...issues, ...meta.issues].slice(0, 50) }) : meta
}

const chunk = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size))
const putChange = (tbl: SyncTable, data: object): SyncChange => ({ tbl, id: (data as { id: string }).id, op: 'put', data: data as Record<string, unknown> })

/**
 * Uploads a whole business that so far lived only on this device, then downloads the server's
 * copy (which may have renumbered things if another device already uploaded part of it).
 */
export async function uploadCompany(db: LedgerDB, api: ApiClient, companyId: string): Promise<void> {
  const company = await db.companies.get(companyId)
  if (!company) throw new Error('Business not found on this device.')
  const lastSeq = (await db.changes.orderBy('seq').last())?.seq ?? 0
  const rows = async <T>(table: string) => (await db.table(table).where('companyId').equals(companyId).toArray()) as T[]
  const all = Object.fromEntries(await Promise.all(SYNC_TABLES.filter((t) => t !== 'companies' && t !== 'audit').map(async (t) => [t, await rows<Record<string, unknown>>(t)] as const)))
  const audit = await db.audit.where('[companyId+at]').between([companyId, 0], [companyId, Infinity]).toArray()

  let batches: PushBatch[] = []
  const add = (changes: SyncChange[]) => changes.length && batches.push({ id: newId(), companyId, changes })
  const send = async () => {
    for (const group of chunk(batches, 40)) {
      const res = await api.push({ deviceId: db.deviceId, batches: group })
      const failed = res.results.find((r) => !r.ok)
      if (failed && !failed.ok) throw new ApiError(409, `Couldn't upload ${company.name}: ${failed.reason}`)
    }
    batches = []
  }
  // The lock date goes last: entries from before it are being uploaded, not newly created.
  const { lockDate, ...unlocked } = company
  add([putChange('companies', unlocked), ...['accounts', 'taxRates', 'contacts', 'items', 'bankRules'].flatMap((t) => all[t].map((r) => putChange(t as SyncTable, r)))])
  const linesByEntry = new Map<string, Record<string, unknown>[]>()
  for (const l of all.journalLines) linesByEntry.set(l.entryId as string, [...(linesByEntry.get(l.entryId as string) ?? []), l])
  const entries = [...all.journalEntries].sort((a, b) => (a.createdAt as number) - (b.createdAt as number))
  for (const group of chunk(entries, 150)) add(group.flatMap((e) => [putChange('journalEntries', e), ...(linesByEntry.get(e.id as string) ?? []).map((l) => putChange('journalLines', l))]))
  for (const t of ['documents', 'payments', 'stockMoves', 'bankLines', 'reconciliations'] as const) for (const group of chunk(all[t], 500)) add(group.map((r) => putChange(t, r)))
  // The business must exist on the server before its files can be stored there.
  await send()
  for (const group of chunk(all.attachments as unknown as Attachment[], 50)) {
    const metas: SyncChange[] = []
    for (const file of group) {
      if (file.missing) continue
      await api.uploadFile(file.id, file.companyId, file.data)
      const { data: _blob, missing: _missing, ...meta } = file
      metas.push(putChange('attachments', meta))
    }
    add(metas)
  }
  for (const group of chunk(audit, 1000)) add(group.map((r) => putChange('audit', r)))
  if (lockDate) add([{ tbl: 'companies', id: companyId, op: 'put', data: { ...company }, fields: ['lockDate'] }])
  await send()
  // Everything saved before the upload started is now on the server.
  await db.changes.where('seq').belowOrEqual(lastSeq).filter((c) => c.companyId === companyId).delete()
  await downloadCompany(db, api, companyId)
  const meta = await readMeta(db)
  await writeMeta(db, { synced: [...new Set([...meta.synced, companyId])], excluded: meta.excluded.filter((id) => id !== companyId) })
}

/** Downloads a business from the account. With `replace`, this device's copy is wiped first. */
export async function downloadCompany(db: LedgerDB, api: ApiClient, companyId: string, opts: { replace?: boolean } = {}): Promise<void> {
  const snap = await api.snapshot(companyId)
  if (opts.replace) await deleteCompany(db, companyId)
  await applyRecords(db, api, snap.records, opts.replace ? new Set() : await pendingKeys(db))
  const meta = await readMeta(db)
  await writeMeta(db, { roles: { ...meta.roles, [companyId]: snap.role } })
}
