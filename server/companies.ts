import type { Member, Role } from '../src/sync/protocol.ts'
import { transaction, type DB } from './db.ts'
import { HttpError } from './http.ts'
import { roleFor } from './sync.ts'

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 }

/** Throws unless the user has at least `min` access to the business. */
export function requireRole(db: DB, companyId: string, userId: string, min: Role): Role {
  const role = roleFor(db, companyId, userId)
  if (!role) throw new HttpError(404, 'Business not found in your account.')
  if (RANK[role] < RANK[min]) throw new HttpError(403, min === 'owner' ? 'Only the owner can do that.' : 'You have view-only access to this business.')
  return role
}

export function deleteCompany(db: DB, userId: string, companyId: string): void {
  requireRole(db, companyId, userId, 'owner')
  transaction(db, () => {
    db.prepare('UPDATE companies SET deleted_at = ? WHERE id = ?').run(Date.now(), companyId)
    db.prepare('DELETE FROM records WHERE company_id = ?').run(companyId)
    db.prepare('DELETE FROM files WHERE company_id = ?').run(companyId)
  })
}

export function listMembers(db: DB, userId: string, companyId: string): Member[] {
  requireRole(db, companyId, userId, 'viewer')
  return db
    .prepare('SELECT u.id AS userId, u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.company_id = ? ORDER BY m.added_at')
    .all(companyId) as unknown as Member[]
}

function checkRole(role: unknown): 'editor' | 'viewer' {
  if (role !== 'editor' && role !== 'viewer') throw new HttpError(400, 'Choose "editor" or "viewer".')
  return role
}

export function addMember(db: DB, userId: string, companyId: string, email: string, role: unknown): Member[] {
  requireRole(db, companyId, userId, 'owner')
  const r = checkRole(role)
  const target = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase()) as { id: string } | undefined
  if (!target) throw new HttpError(404, 'No Ledgerly account uses that email yet. Ask them to create one, then invite them again.')
  if (db.prepare('SELECT 1 FROM members WHERE company_id = ? AND user_id = ?').get(companyId, target.id)) {
    throw new HttpError(409, 'That person already has access.')
  }
  db.prepare('INSERT INTO members (company_id, user_id, role, added_at) VALUES (?, ?, ?, ?)').run(companyId, target.id, r, Date.now())
  return listMembers(db, userId, companyId)
}

export function updateMember(db: DB, userId: string, companyId: string, memberId: string, role: unknown): Member[] {
  requireRole(db, companyId, userId, 'owner')
  const r = checkRole(role)
  if (roleFor(db, companyId, memberId) === 'owner') throw new HttpError(400, "The owner's access can't be changed.")
  db.prepare('UPDATE members SET role = ? WHERE company_id = ? AND user_id = ?').run(r, companyId, memberId)
  return listMembers(db, userId, companyId)
}

/** The owner can remove anyone else; anyone else can remove themselves (leave). */
export function removeMember(db: DB, userId: string, companyId: string, memberId: string): void {
  const role = requireRole(db, companyId, userId, 'viewer')
  if (memberId === userId) {
    if (role === 'owner') throw new HttpError(400, "The owner can't leave. Delete the business instead.")
  } else if (role !== 'owner') {
    throw new HttpError(403, 'Only the owner can remove people.')
  }
  db.prepare('DELETE FROM members WHERE company_id = ? AND user_id = ?').run(companyId, memberId)
}

const MAX_FILE = 12 * 1024 * 1024

export function putFile(db: DB, userId: string, fileId: string, companyId: string, type: string, data: Buffer): void {
  requireRole(db, companyId, userId, 'editor')
  if (!/^[\w-]{1,100}$/.test(fileId)) throw new HttpError(400, 'Invalid file id.')
  if (data.length > MAX_FILE) throw new HttpError(413, 'Files can be up to 10 MB.')
  const existing = db.prepare('SELECT company_id FROM files WHERE id = ?').get(fileId) as { company_id: string } | undefined
  if (existing && existing.company_id !== companyId) throw new HttpError(403, 'That file belongs to another business.')
  db.prepare('INSERT INTO files (id, company_id, type, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET type = excluded.type, size = excluded.size, data = excluded.data').run(
    fileId,
    companyId,
    type.slice(0, 100) || 'application/octet-stream',
    data.length,
    data,
    Date.now(),
  )
}

export function getFile(db: DB, userId: string, fileId: string): { type: string; data: Uint8Array } {
  const file = db.prepare('SELECT company_id, type, data FROM files WHERE id = ?').get(fileId) as { company_id: string; type: string; data: Uint8Array } | undefined
  if (!file) throw new HttpError(404, 'File not found.')
  requireRole(db, file.company_id, userId, 'viewer')
  return { type: file.type, data: file.data }
}
