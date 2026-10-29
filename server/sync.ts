import type { StatementSync } from 'node:sqlite'
import {
  SYNC_TABLES,
  type BatchResult,
  type CompanyAccess,
  type PullResponse,
  type PushBatch,
  type PushRequest,
  type PushResponse,
  type Role,
  type ServerRecord,
  type SnapshotResponse,
  type SyncTable,
} from '../src/sync/protocol.ts'
import { currentSeq, nextSeq, transaction, type DB } from './db.ts'
import { HttpError } from './http.ts'

type Data = Record<string, unknown>

/** A batch the server refuses, with a message the app can show to the user. */
class Reject extends Error {}

const TABLES = new Set<string>(SYNC_TABLES)
const DELETABLE = new Set<SyncTable>(['accounts', 'taxRates'])
const MAX_RECORD_CHARS = 256 * 1024
const key = (tbl: string, id: string) => `${tbl}\u0000${id}`

const statements = new WeakMap<DB, Map<string, StatementSync>>()
function sql(db: DB, text: string): StatementSync {
  let cache = statements.get(db)
  if (!cache) statements.set(db, (cache = new Map()))
  let stmt = cache.get(text)
  if (!stmt) cache.set(text, (stmt = db.prepare(text)))
  return stmt
}

/** JSON with sorted keys, so merged records compare equal regardless of key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  )
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function roleFor(db: DB, companyId: string, userId: string): Role | null {
  const row = sql(db, 'SELECT m.role FROM members m JOIN companies c ON c.id = m.company_id WHERE m.company_id = ? AND m.user_id = ? AND c.deleted_at IS NULL').get(
    companyId,
    userId,
  ) as { role: Role } | undefined
  return row?.role ?? null
}

export function listAccess(db: DB, userId: string): { companies: CompanyAccess[]; deleted: string[] } {
  const rows = sql(
    db,
    `SELECT c.id, m.role, c.deleted_at,
       (SELECT json_extract(r.data, '$.name') FROM records r WHERE r.tbl = 'companies' AND r.id = c.id) AS name
     FROM members m JOIN companies c ON c.id = m.company_id WHERE m.user_id = ?`,
  ).all(userId) as { id: string; role: Role; deleted_at: number | null; name: string | null }[]
  return {
    companies: rows.filter((r) => r.deleted_at === null).map((r) => ({ id: r.id, role: r.role, name: r.name ?? 'Untitled business' })),
    deleted: rows.filter((r) => r.deleted_at !== null).map((r) => r.id),
  }
}

function parsePush(body: unknown): PushRequest {
  const bad = (msg = 'Invalid sync request.') => new HttpError(400, msg)
  const b = body as Partial<PushRequest> | null
  if (!b || typeof b.deviceId !== 'string' || !b.deviceId || !Array.isArray(b.batches)) throw bad()
  if (b.batches.length > 500) throw bad('Too many batches in one request.')
  for (const batch of b.batches as Partial<PushBatch>[]) {
    if (typeof batch?.id !== 'string' || typeof batch.companyId !== 'string' || !Array.isArray(batch.changes) || batch.changes.length > 20_000) throw bad()
    for (const c of batch.changes) {
      if (!c || !TABLES.has(c.tbl) || typeof c.id !== 'string' || !c.id || c.id.length > 100 || (c.op !== 'put' && c.op !== 'delete')) throw bad()
      if (c.fields !== undefined && (!Array.isArray(c.fields) || c.fields.some((f) => typeof f !== 'string'))) throw bad()
      if (c.op === 'put') {
        if (!c.data || typeof c.data !== 'object' || Array.isArray(c.data) || c.data.id !== c.id) throw bad()
        const owner = c.tbl === 'companies' ? c.data.id : c.data.companyId
        if (owner !== batch.companyId) throw bad('A change belongs to a different business than its batch.')
        if (JSON.stringify(c.data).length > MAX_RECORD_CHARS) throw new HttpError(413, 'A record is too large.')
      }
    }
  }
  return b as PushRequest
}

export function push(db: DB, userId: string, body: unknown): PushResponse {
  const request = parsePush(body)
  // Entry numbers the server changed earlier in this request, so later batches can follow them.
  const renames = new Map<string, Map<string, string>>()
  return { results: request.batches.map((batch) => applyBatch(db, userId, request.deviceId, batch, renames)) }
}

function applyBatch(db: DB, userId: string, deviceId: string, batch: PushBatch, renames: Map<string, Map<string, string>>): BatchResult {
  try {
    const rewritten = transaction(db, () => new BatchApplier(db, userId, deviceId, batch, renames).run())
    return { batchId: batch.id, ok: true, rewritten }
  } catch (err) {
    if (!(err instanceof Reject)) throw err
    return { batchId: batch.id, ok: false, reason: err.message, current: currentVersions(db, batch) }
  }
}

function currentVersions(db: DB, batch: PushBatch): ServerRecord[] {
  const seen = new Set<string>()
  const out: ServerRecord[] = []
  for (const c of batch.changes) {
    if (seen.has(key(c.tbl, c.id))) continue
    seen.add(key(c.tbl, c.id))
    const row = sql(db, 'SELECT company_id, data FROM records WHERE tbl = ? AND id = ?').get(c.tbl, c.id) as { company_id: string; data: string | null } | undefined
    const data = row && row.company_id === batch.companyId && row.data ? (JSON.parse(row.data) as Data) : null
    out.push({ tbl: c.tbl, id: c.id, companyId: batch.companyId, data })
  }
  return out
}

class BatchApplier {
  private written = new Map<string, ServerRecord>()
  private newEntries: string[] = []
  private newLines: Data[] = []
  private db: DB
  private userId: string
  private deviceId: string
  private batch: PushBatch
  private companyId: string
  private renames: Map<string, string>
  private now = Date.now()

  constructor(db: DB, userId: string, deviceId: string, batch: PushBatch, renames: Map<string, Map<string, string>>) {
    this.db = db
    this.userId = userId
    this.deviceId = deviceId
    this.batch = batch
    this.companyId = batch.companyId
    if (!renames.has(batch.companyId)) renames.set(batch.companyId, new Map())
    this.renames = renames.get(batch.companyId)!
  }

  run(): ServerRecord[] {
    this.checkAccess()
    const sent = new Map<string, Data | null>()
    const audits: Data[] = []

    for (const c of this.batch.changes) {
      sent.set(key(c.tbl, c.id), c.op === 'delete' ? null : c.data!)
      if (c.op === 'delete') {
        this.remove(c.tbl, c.id)
        continue
      }
      const data = c.data as Data
      if (c.tbl === 'audit') {
        if (this.get('audit', c.id) === undefined) audits.push(data)
        continue
      }
      const existing = this.get(c.tbl, c.id)
      if (existing == null) this.insert(c.tbl, data)
      else this.update(c.tbl, existing, data, c.fields)
    }

    this.validateNewEntries()
    for (const a of audits) this.put('audit', a.id as string, { ...a, summary: this.applyRenames(String(a.summary ?? '')) })
    this.bumpCounter()

    // Whatever the server changed goes back to the sender, and is tagged so the sender's own pulls include it too.
    const out: ServerRecord[] = []
    for (const [k, rec] of this.written) {
      if (sent.has(k) && canonical(sent.get(k)) === canonical(rec.data)) continue
      out.push(rec)
      sql(this.db, "UPDATE records SET device_id = 'server' WHERE tbl = ? AND id = ?").run(rec.tbl, rec.id)
    }
    return out
  }

  private checkAccess(): void {
    const company = sql(this.db, 'SELECT deleted_at FROM companies WHERE id = ?').get(this.companyId) as { deleted_at: number | null } | undefined
    if (company) {
      if (company.deleted_at) throw new Reject('This business was deleted from the account.')
      const role = roleFor(this.db, this.companyId, this.userId)
      if (!role) throw new Reject("You don't have access to this business.")
      if (role === 'viewer') throw new Reject('You have view-only access to this business.')
      return
    }
    if (!this.batch.changes.some((c) => c.tbl === 'companies' && c.op === 'put' && c.id === this.companyId)) {
      throw new Reject("This business hasn't been uploaded to your account yet.")
    }
    sql(this.db, 'INSERT INTO companies (id, owner_id, created_at) VALUES (?, ?, ?)').run(this.companyId, this.userId, this.now)
    sql(this.db, 'INSERT INTO members (company_id, user_id, role, added_at) VALUES (?, ?, ?, ?)').run(this.companyId, this.userId, 'owner', this.now)
  }

  /** undefined: never existed. null: deleted. */
  private get(tbl: SyncTable, id: string): Data | null | undefined {
    const w = this.written.get(key(tbl, id))
    if (w) return w.data
    const row = sql(this.db, 'SELECT company_id, data FROM records WHERE tbl = ? AND id = ?').get(tbl, id) as { company_id: string; data: string | null } | undefined
    if (!row) return undefined
    if (row.company_id !== this.companyId) throw new Reject('A record in this change belongs to another business.')
    return row.data === null ? null : (JSON.parse(row.data) as Data)
  }

  private put(tbl: SyncTable, id: string, data: Data | null): void {
    sql(
      this.db,
      `INSERT INTO records (tbl, id, company_id, data, seq, device_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tbl, id) DO UPDATE SET data = excluded.data, seq = excluded.seq, device_id = excluded.device_id, updated_at = excluded.updated_at`,
    ).run(tbl, id, this.companyId, data === null ? null : JSON.stringify(data), nextSeq(this.db), this.deviceId, this.now)
    this.written.set(key(tbl, id), { tbl, id, companyId: this.companyId, data })
  }

  private remove(tbl: SyncTable, id: string): void {
    const existing = this.get(tbl, id)
    if (existing == null) return
    if (!DELETABLE.has(tbl)) throw new Reject("Posted records can't be deleted.")
    if (tbl === 'accounts' && this.accountInUse(id)) {
      throw new Reject(`"${String(existing.name)}" has transactions from another device, so it was kept. Archive it instead.`)
    }
    this.put(tbl, id, null)
  }

  private insert(tbl: SyncTable, data: Data): void {
    const id = data.id as string
    if (tbl === 'accounts') data = this.uniqueAccount(data)
    if (tbl === 'journalEntries') {
      // An entry only counts as reversed once its reversal exists; validateNewEntries sets it when it arrives.
      const { reversedById: _ignored, ...rest } = data
      data = { ...rest, status: 'posted' }
      this.newEntries.push(id)
    }
    if (tbl === 'journalLines') this.newLines.push(data)
    this.put(tbl, id, data)
  }

  private update(tbl: SyncTable, existing: Data, incoming: Data, fields?: string[]): void {
    const patch = fields ? Object.fromEntries(fields.filter((f) => f in incoming).map((f) => [f, incoming[f]])) : incoming
    let merged: Data
    switch (tbl) {
      case 'companies': {
        const counter = (d: Data) => num((d.nextNumbers as Data | undefined)?.journal)
        merged = { ...existing, ...patch, nextNumbers: { journal: Math.max(counter(existing), counter(incoming)) } }
        break
      }
      case 'accounts':
        merged = { ...existing, ...patch }
        if (merged.type !== existing.type && this.accountInUse(existing.id as string)) {
          merged.type = existing.type
          merged.subtype = existing.subtype
        }
        merged = this.uniqueAccount(merged)
        break
      case 'taxRates':
        merged = { ...existing, ...patch }
        break
      case 'journalEntries': {
        // Posted entries are immutable; the only allowed change is being marked reversed.
        merged = existing
        const reversedById = incoming.reversedById as string | undefined
        if (incoming.status === 'reversed' && reversedById && reversedById !== existing.reversedById) {
          const reversal = this.get('journalEntries', reversedById)
          if (reversal && reversal.reversalOfId === existing.id) {
            if (existing.status === 'reversed') throw new Reject(`${String(existing.number)} was already reversed on another device.`)
            merged = { ...existing, status: 'reversed', reversedById, updatedAt: incoming.updatedAt }
          }
        }
        break
      }
      default:
        return
    }
    if (canonical(merged) !== canonical(existing)) this.put(tbl, existing.id as string, merged)
  }

  private validateNewEntries(): void {
    const newIds = new Set(this.newEntries)
    const linesByEntry = new Map<string, Data[]>()
    for (const line of this.newLines) {
      const entryId = line.entryId as string
      if (!newIds.has(entryId)) throw new Reject('Journal lines can only be added together with their entry.')
      linesByEntry.set(entryId, [...(linesByEntry.get(entryId) ?? []), line])
    }
    if (!this.newEntries.length) return

    const company = this.get('companies', this.companyId)
    if (!company) throw new Reject('This business is missing on the server.')
    const lockDate = typeof company.lockDate === 'string' ? company.lockDate : undefined

    for (const id of this.newEntries) {
      const entry = { ...(this.get('journalEntries', id) as Data) }
      const label = String(entry.number ?? 'An entry')
      const date = entry.date
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Reject(`${label} has an invalid date.`)
      if (lockDate && date <= lockDate) throw new Reject(`${label} is dated ${date}, but the books are locked up to ${lockDate}.`)

      const lines = linesByEntry.get(id) ?? []
      if (lines.length < 2) throw new Reject(`${label} needs at least two lines.`)
      let debit = 0
      let credit = 0
      for (const l of lines) {
        const d = l.debit as number
        const c = l.credit as number
        if (!Number.isSafeInteger(d) || !Number.isSafeInteger(c) || d < 0 || c < 0 || d > 0 === c > 0) throw new Reject(`${label} has an invalid line.`)
        if (l.date !== date) throw new Reject(`${label} has lines with a different date.`)
        if (!this.get('accounts', l.accountId as string)) throw new Reject(`${label} uses an account that no longer exists.`)
        debit += d
        credit += c
      }
      if (debit !== credit) throw new Reject(`${label} doesn't balance.`)
      entry.total = debit

      if (entry.reversalOfId) {
        const original = this.get('journalEntries', entry.reversalOfId as string)
        if (!original) throw new Reject(`The entry that ${label} reverses is missing.`)
        if (original.status === 'reversed' && original.reversedById !== id) {
          throw new Reject(`${String(original.number)} was already reversed on another device.`)
        }
        if (original.status !== 'reversed') this.put('journalEntries', original.id as string, { ...original, status: 'reversed', reversedById: id, updatedAt: entry.createdAt })
        if (typeof entry.memo === 'string') entry.memo = entry.memo.replace(/^Reversal of JE-\d+/, `Reversal of ${String(original.number)}`)
      }

      // Two devices offline can both create, say, JE-0042. The first to sync keeps it; the other gets the next free number.
      const number = String(entry.number)
      if (!/^JE-\d+$/.test(number) || this.numberTaken(number, id)) {
        const next = `JE-${String(this.maxNumber() + 1).padStart(4, '0')}`
        this.renames.set(number, next)
        entry.number = next
      }
      this.put('journalEntries', id, entry)
    }
  }

  private bumpCounter(): void {
    const company = this.get('companies', this.companyId)
    if (!company) return
    const next = this.maxNumber() + 1
    if (num((company.nextNumbers as Data | undefined)?.journal) < next) {
      this.put('companies', this.companyId, { ...company, nextNumbers: { ...(company.nextNumbers as Data | undefined), journal: next } })
    }
  }

  private numberTaken(number: string, selfId: string): boolean {
    return !!sql(
      this.db,
      "SELECT 1 FROM records WHERE company_id = ? AND tbl = 'journalEntries' AND data IS NOT NULL AND json_extract(data, '$.number') = ? AND id != ? LIMIT 1",
    ).get(this.companyId, number, selfId)
  }

  private maxNumber(): number {
    const row = sql(
      this.db,
      "SELECT MAX(CAST(substr(json_extract(data, '$.number'), 4) AS INTEGER)) AS n FROM records WHERE company_id = ? AND tbl = 'journalEntries' AND data IS NOT NULL",
    ).get(this.companyId) as { n: number | null }
    return row.n ?? 0
  }

  private accountInUse(accountId: string): boolean {
    return !!sql(
      this.db,
      "SELECT 1 FROM records WHERE company_id = ? AND tbl = 'journalLines' AND data IS NOT NULL AND json_extract(data, '$.accountId') = ? LIMIT 1",
    ).get(this.companyId, accountId)
  }

  /** Two devices can add accounts with the same code or name while offline; keep both but make them distinct. */
  private uniqueAccount(data: Data): Data {
    const clash = (field: string, value: string) =>
      !!sql(
        this.db,
        `SELECT 1 FROM records WHERE company_id = ? AND tbl = 'accounts' AND data IS NOT NULL AND id != ? AND lower(json_extract(data, '$.' || ?)) = lower(?) LIMIT 1`,
      ).get(this.companyId, data.id as string, field, value)
    let code = String(data.code ?? '')
    if (clash('code', code)) {
      const base = Number(code)
      let n = 2
      do code = Number.isInteger(base) && /^\d+$/.test(String(data.code)) ? String(base + n - 1) : `${String(data.code)}-${n}`
      while (clash('code', code) && n++ < 1000)
    }
    let name = String(data.name ?? '')
    for (let n = 2; clash('name', name) && n < 1000; n++) name = `${String(data.name)} (${n})`
    return code === data.code && name === data.name ? data : { ...data, code, name }
  }

  private applyRenames(text: string): string {
    if (!this.renames.size) return text
    const pattern = new RegExp(`\\b(${[...this.renames.keys()].map((k) => k.replace(/[-]/g, '\\-')).join('|')})\\b`, 'g')
    return text.replace(pattern, (m) => this.renames.get(m) ?? m)
  }
}

export function pull(db: DB, userId: string, query: URLSearchParams): PullResponse {
  const since = Math.max(0, Math.floor(Number(query.get('since')) || 0))
  const limit = Math.min(5000, Math.max(1, Math.floor(Number(query.get('limit')) || 2000)))
  const device = query.get('device') ?? ''
  const access = listAccess(db, userId)
  const rows = sql(
    db,
    'SELECT tbl, id, company_id, data, seq, device_id FROM records WHERE seq > ? AND company_id IN (SELECT value FROM json_each(?)) ORDER BY seq LIMIT ?',
  ).all(since, JSON.stringify(access.companies.map((c) => c.id)), limit) as {
    tbl: SyncTable
    id: string
    company_id: string
    data: string | null
    seq: number
    device_id: string
  }[]
  const more = rows.length === limit
  return {
    changes: rows
      .filter((r) => r.device_id !== device)
      .map((r) => ({ seq: r.seq, tbl: r.tbl, id: r.id, companyId: r.company_id, data: r.data === null ? null : (JSON.parse(r.data) as Data) })),
    cursor: more ? rows[rows.length - 1].seq : currentSeq(db),
    more,
    companies: access.companies,
    deletedCompanies: access.deleted,
  }
}

export function snapshot(db: DB, userId: string, companyId: string): SnapshotResponse {
  const role = roleFor(db, companyId, userId)
  if (!role) throw new HttpError(404, 'Business not found in your account.')
  const rows = sql(db, 'SELECT tbl, id, data FROM records WHERE company_id = ? AND data IS NOT NULL').all(companyId) as { tbl: SyncTable; id: string; data: string }[]
  return {
    records: rows.map((r) => ({ tbl: r.tbl, id: r.id, companyId, data: JSON.parse(r.data) as Data })),
    cursor: currentSeq(db),
    role,
  }
}
