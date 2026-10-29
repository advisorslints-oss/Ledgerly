import { useSyncExternalStore } from 'react'
import { deleteCompany } from '../accounting/company'
import { errorMessage } from '../accounting/errors'
import { db } from '../db'
import { ApiClient, ApiError } from './api'
import { downloadCompany, readMeta, syncOnce, uploadCompany, writeMeta, type SyncMeta } from './engine'
import type { Member, Role } from './protocol'

export type SyncStatus = 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error'

export interface SyncState {
  ready: boolean
  meta: SyncMeta
  status: SyncStatus
  error?: string
  /** A business currently uploading or downloading, with a short label for the UI. */
  busy?: string
}

let state: SyncState = { ready: false, status: 'signed-out', meta: { cursor: 0, synced: [], excluded: [], roles: {}, access: [], issues: [] } }
const listeners = new Set<() => void>()
let api: ApiClient | null = null
let running: Promise<void> | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let started = false

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch }
  db.readOnlyCompanies = new Set(Object.entries(state.meta.roles).filter(([id, role]) => role === 'viewer' && state.meta.synced.includes(id)).map(([id]) => id))
  listeners.forEach((l) => l())
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

const online = () => typeof navigator === 'undefined' || navigator.onLine

/** Loads the saved session and starts syncing in the background. Call once at startup. */
export async function startSync(): Promise<void> {
  if (started) return
  started = true
  const meta = await readMeta(db)
  api = meta.session ? new ApiClient(meta.session.server, meta.session.token) : null
  set({ ready: true, meta, status: meta.session ? (online() ? 'idle' : 'offline') : 'signed-out' })
  // While signed out the outbox has no use (a business uploads in full when sync is turned on).
  if (!meta.session) await db.changes.clear()

  db.onWrite(() => schedule(1500))
  window.addEventListener('online', () => schedule(0))
  window.addEventListener('offline', () => state.meta.session && set({ status: 'offline' }))
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && schedule(0))
  setInterval(() => document.visibilityState === 'visible' && schedule(0), 30_000)
  if (meta.session) schedule(0)
}

function schedule(delay: number) {
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (state.meta.session) void syncNow()
    else void db.changes.clear()
  }, delay)
}

/** Runs one sync now (or joins the one already running). Never throws; the outcome is in the state. */
export function syncNow(): Promise<void> {
  if (!api || !state.meta.session) return Promise.resolve()
  if (!online()) {
    set({ status: 'offline' })
    return Promise.resolve()
  }
  running ??= (async () => {
    set({ status: 'syncing' })
    try {
      const client = api!
      // Only one tab syncs at a time; the others wait their turn.
      const meta = navigator.locks ? await navigator.locks.request('ledgerly-sync', () => syncOnce(db, client)) : await syncOnce(db, client)
      set({ meta, status: 'idle', error: undefined })
    } catch (err) {
      await handleError(err)
    } finally {
      running = null
    }
  })()
  return running
}

async function handleError(err: unknown) {
  if (err instanceof ApiError && err.status === 401) {
    const meta = await writeMeta(db, { session: undefined })
    api = null
    set({ meta, status: 'signed-out', error: 'Your session ended. Sign in again to keep syncing.' })
  } else if (err instanceof ApiError && err.status === 0) {
    set({ status: 'offline' })
  } else {
    set({ status: 'error', error: err instanceof ApiError ? err.message : errorMessage(err) })
  }
}

async function begin(server: string, auth: Promise<{ token: string; user: { id: string; email: string; name: string } }>) {
  const { token, user } = await auth
  const previous = await readMeta(db)
  // A different person signing in on this device starts from a clean sync state.
  const sameUser = previous.session?.user.id === user.id
  const meta = await writeMeta(db, { session: { token, user, server }, ...(sameUser ? {} : { cursor: 0, synced: [], excluded: [], roles: {}, access: [], issues: [] }) })
  api = new ApiClient(server, token)
  set({ meta, status: 'idle', error: undefined })
  await syncNow()
}

export function signIn(server: string, email: string, password: string) {
  return begin(server, new ApiClient(server).login(email, password))
}

export function signUp(server: string, name: string, email: string, password: string) {
  return begin(server, new ApiClient(server).signup(name, email, password))
}

/** Signs out. Synced businesses stay on the device unless `removeSynced` is set (e.g. a shared computer). */
export async function signOut(opts: { removeSynced?: boolean } = {}): Promise<void> {
  try {
    await api?.logout()
  } catch {
    // Signing out locally still works when the server can't be reached.
  }
  if (opts.removeSynced) for (const id of state.meta.synced) await deleteCompany(db, id)
  await db.changes.clear()
  const meta = await writeMeta(db, { session: undefined, cursor: 0, synced: [], excluded: [], roles: {}, access: [] })
  api = null
  set({ meta, status: 'signed-out', error: undefined })
}

async function withBusy<T>(label: string, fn: (client: ApiClient) => Promise<T>): Promise<T> {
  if (!api) throw new Error('Sign in first.')
  set({ busy: label })
  try {
    await running
    return await fn(api)
  } finally {
    set({ busy: undefined, meta: await readMeta(db) })
  }
}

/** Uploads a business that so far lived only on this device, then keeps it in sync. */
export async function startSyncing(companyId: string): Promise<void> {
  await withBusy(companyId, (client) => uploadCompany(db, client, companyId))
  await syncNow()
}

/** Gets a business from the account onto this device. */
export async function downloadToDevice(companyId: string): Promise<void> {
  await withBusy(companyId, async (client) => {
    await downloadCompany(db, client, companyId, { replace: !!(await db.companies.get(companyId)) })
    const meta = await readMeta(db)
    await writeMeta(db, { synced: [...new Set([...meta.synced, companyId])], excluded: meta.excluded.filter((id) => id !== companyId) })
  })
  await syncNow()
}

/** Removes a synced business from this device only. It stays in the account and on other devices. */
export async function removeFromDevice(companyId: string): Promise<void> {
  await running
  await deleteCompany(db, companyId)
  const meta = await readMeta(db)
  set({ meta: await writeMeta(db, { synced: meta.synced.filter((id) => id !== companyId), excluded: [...new Set([...meta.excluded, companyId])] }) })
}

/** Deletes a business from the account and every device. Owner only. */
export async function deleteEverywhere(companyId: string): Promise<void> {
  await withBusy(companyId, (client) => client.deleteCompany(companyId))
  await deleteCompany(db, companyId)
  const meta = await readMeta(db)
  set({ meta: await writeMeta(db, { synced: meta.synced.filter((id) => id !== companyId) }) })
}

export async function dismissIssue(id: string): Promise<void> {
  const meta = await readMeta(db)
  set({ meta: await writeMeta(db, { issues: meta.issues.filter((i) => i.id !== id) }) })
}

function client(): ApiClient {
  if (!api) throw new Error('Sign in first.')
  return api
}

export const team = {
  list: (companyId: string): Promise<Member[]> => client().members(companyId).then((r) => r.members),
  invite: (companyId: string, email: string, role: Exclude<Role, 'owner'>) => client().addMember(companyId, email, role).then((r) => r.members),
  setRole: (companyId: string, userId: string, role: Exclude<Role, 'owner'>) => client().updateMember(companyId, userId, role).then((r) => r.members),
  remove: (companyId: string, userId: string) => client().removeMember(companyId, userId),
}
