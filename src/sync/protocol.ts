// Wire format shared by the app and the sync server. Keep this file free of imports so the
// server can load it directly.

export const SYNC_TABLES = [
  'companies',
  'accounts',
  'journalEntries',
  'journalLines',
  'taxRates',
  'audit',
  'contacts',
  'items',
  'documents',
  'payments',
  'stockMoves',
  'bankLines',
  'bankRules',
  'reconciliations',
  'attachments',
  'recurring',
  'reminders',
] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

export type Role = 'owner' | 'editor' | 'viewer'

export interface PublicUser {
  id: string
  email: string
  name: string
}

export interface AuthResponse {
  token: string
  user: PublicUser
}

export interface SyncChange {
  tbl: SyncTable
  id: string
  op: 'put' | 'delete'
  /** For updates: only these fields changed, so the server merges them instead of replacing the record. */
  fields?: string[]
  data?: Record<string, unknown>
}

/** One local write transaction. The server applies or rejects it as a whole. */
export interface PushBatch {
  id: string
  companyId: string
  changes: SyncChange[]
}

export interface PushRequest {
  deviceId: string
  batches: PushBatch[]
}

export interface ServerRecord {
  tbl: SyncTable
  id: string
  companyId: string
  /** null means the record was deleted (or never existed, in a rejection). */
  data: Record<string, unknown> | null
}

export type BatchResult =
  | { batchId: string; ok: true; rewritten: ServerRecord[] }
  | { batchId: string; ok: false; reason: string; current: ServerRecord[] }

export interface PushResponse {
  results: BatchResult[]
}

export interface CompanyAccess {
  id: string
  name: string
  role: Role
}

export interface PullResponse {
  changes: (ServerRecord & { seq: number })[]
  cursor: number
  more: boolean
  companies: CompanyAccess[]
  deletedCompanies: string[]
}

export interface SnapshotResponse {
  records: ServerRecord[]
  cursor: number
  role: Role
}

export interface Member {
  userId: string
  email: string
  name: string
  role: Role
}
