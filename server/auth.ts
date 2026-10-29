import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { AuthResponse, PublicUser } from '../src/sync/protocol.ts'
import type { DB } from './db.ts'
import { HttpError } from './http.ts'

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>
const PARAMS = { N: 16384, r: 8, p: 1 }
const KEY_LENGTH = 64
const SESSION_DAYS = 90

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, KEY_LENGTH, PARAMS)
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split('$')
  if (algo !== 'scrypt') return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) })
  return timingSafeEqual(actual, expected)
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

function createSession(db: DB, userId: string): string {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    now,
    now + SESSION_DAYS * 86_400_000,
    now,
  )
  return token
}

interface UserRow {
  id: string
  email: string
  name: string
  password_hash: string
}

const toPublic = (u: UserRow): PublicUser => ({ id: u.id, email: u.email, name: u.name })

function normaliseEmail(email: string): string {
  const e = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) throw new HttpError(400, 'Enter a valid email address.')
  return e
}

function checkPassword(password: string): void {
  if (password.length < 8) throw new HttpError(400, 'Use a password of at least 8 characters.')
  if (password.length > 200) throw new HttpError(400, 'That password is too long.')
}

export async function signup(db: DB, input: { name: string; email: string; password: string }): Promise<AuthResponse> {
  const email = normaliseEmail(input.email)
  const name = input.name.trim()
  if (!name || name.length > 80) throw new HttpError(400, 'Enter your name.')
  checkPassword(input.password)
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw new HttpError(409, 'An account with this email already exists. Sign in instead.')
  }
  const user: UserRow = { id: randomUUID(), email, name, password_hash: await hashPassword(input.password) }
  db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(user.id, email, name, user.password_hash, Date.now())
  return { token: createSession(db, user.id), user: toPublic(user) }
}

export async function login(db: DB, input: { email: string; password: string }): Promise<AuthResponse> {
  const email = normaliseEmail(input.email)
  const user = db.prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?').get(email) as UserRow | undefined
  // Hash even when the user doesn't exist so response time doesn't reveal which emails have accounts.
  const ok = user ? await verifyPassword(input.password, user.password_hash) : (await hashPassword(input.password), false)
  if (!user || !ok) throw new HttpError(401, 'Email or password is incorrect.')
  return { token: createSession(db, user.id), user: toPublic(user) }
}

export function logout(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
}

export function userFromToken(db: DB, token: string): PublicUser | null {
  const row = db
    .prepare('SELECT u.id, u.email, u.name, s.expires_at, s.last_used_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
    .get(hashToken(token)) as (PublicUser & { expires_at: number; last_used_at: number }) | undefined
  if (!row) return null
  const now = Date.now()
  if (row.expires_at < now) {
    logout(db, token)
    return null
  }
  if (now - row.last_used_at > 3_600_000) db.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?').run(now, hashToken(token))
  return { id: row.id, email: row.email, name: row.name }
}
