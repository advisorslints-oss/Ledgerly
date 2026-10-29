import { existsSync, readFileSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { login, logout, signup, userFromToken } from './auth.ts'
import { addMember, deleteCompany, getFile, listMembers, putFile, removeMember, updateMember } from './companies.ts'
import type { DB } from './db.ts'
import { HttpError, RateLimiter, readJson, readRaw, Router, sendJson, setCors, str, type Ctx } from './http.ts'
import { listAccess, pull, push, snapshot } from './sync.ts'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/** Serves the built app. Unknown paths without a file extension get index.html so client routes work. */
function serveStatic(root: string, pathname: string, res: ServerResponse): void {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '')
  let file = join(root, safe)
  if (!file.startsWith(root + sep) && file !== root) return void sendJson(res, 404, { error: 'Not found.' })
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (extname(safe)) return void sendJson(res, 404, { error: 'Not found.' })
    file = join(root, 'index.html')
  }
  const name = file.slice(root.length + 1).replace(/\\/g, '/')
  const immutable = name.startsWith('assets/')
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(readFileSync(file))
}

export function createApp({ db, staticDir }: { db: DB; staticDir?: string }) {
  const router = new Router()
  const limiter = new RateLimiter(30, 10 * 60_000)

  const auth = (ctx: Ctx) => {
    const header = ctx.req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const user = token ? userFromToken(db, token) : null
    if (!user) throw new HttpError(401, 'Your session has ended. Please sign in again.')
    return { user, token }
  }

  router.add('GET', '/api/health', () => ({ ok: true }))

  router.add('POST', '/api/auth/signup', async (ctx) => {
    limiter.check(`auth:${ctx.ip}`)
    const body = await ctx.body()
    return signup(db, { name: str(body, 'name', { max: 80 }), email: str(body, 'email'), password: str(body, 'password', { min: 1, max: 200 }) })
  })
  router.add('POST', '/api/auth/login', async (ctx) => {
    limiter.check(`auth:${ctx.ip}`)
    const body = await ctx.body()
    return login(db, { email: str(body, 'email'), password: str(body, 'password', { max: 200 }) })
  })
  router.add('POST', '/api/auth/logout', (ctx) => {
    logout(db, auth(ctx).token)
  })
  router.add('GET', '/api/auth/me', (ctx) => ({ user: auth(ctx).user }))

  router.add('GET', '/api/companies', (ctx) => ({ companies: listAccess(db, auth(ctx).user.id).companies }))
  router.add('GET', '/api/companies/:id/snapshot', (ctx) => snapshot(db, auth(ctx).user.id, ctx.params.id))
  router.add('DELETE', '/api/companies/:id', (ctx) => {
    deleteCompany(db, auth(ctx).user.id, ctx.params.id)
  })
  router.add('GET', '/api/companies/:id/members', (ctx) => ({ members: listMembers(db, auth(ctx).user.id, ctx.params.id) }))
  router.add('POST', '/api/companies/:id/members', async (ctx) => {
    const { user } = auth(ctx)
    const body = (await ctx.body()) as { role?: unknown }
    return { members: addMember(db, user.id, ctx.params.id, str(body, 'email'), body?.role) }
  })
  router.add('PATCH', '/api/companies/:id/members/:userId', async (ctx) => {
    const { user } = auth(ctx)
    const body = (await ctx.body()) as { role?: unknown }
    return { members: updateMember(db, user.id, ctx.params.id, ctx.params.userId, body?.role) }
  })
  router.add('DELETE', '/api/companies/:id/members/:userId', (ctx) => {
    removeMember(db, auth(ctx).user.id, ctx.params.id, ctx.params.userId)
  })

  router.add('POST', '/api/sync/push', async (ctx) => push(db, auth(ctx).user.id, await ctx.body()))
  router.add('GET', '/api/sync/pull', (ctx) => pull(db, auth(ctx).user.id, ctx.query))

  router.add('PUT', '/api/files/:id', async (ctx) => {
    const { user } = auth(ctx)
    const companyId = ctx.query.get('company') ?? ''
    putFile(db, user.id, ctx.params.id, companyId, String(ctx.req.headers['content-type'] ?? ''), await readRaw(ctx.req, 12 * 1024 * 1024))
    return { ok: true }
  })
  router.add('GET', '/api/files/:id', (ctx) => {
    const file = getFile(db, auth(ctx).user.id, ctx.params.id)
    ctx.res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' })
    ctx.res.end(Buffer.from(file.data))
  })

  const root = staticDir ? normalize(staticDir) : undefined

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/api/')) {
      if (root && (req.method === 'GET' || req.method === 'HEAD')) return serveStatic(root, url.pathname, res)
      return sendJson(res, 404, { error: 'Not found.' })
    }
    setCors(res)
    if (req.method === 'OPTIONS') return void res.writeHead(204).end()
    const match = router.match(req.method ?? 'GET', url.pathname)
    if (!match) return sendJson(res, 404, { error: 'Not found.' })
    if (match === 'method') return sendJson(res, 405, { error: 'Method not allowed.' })
    try {
      let parsed: Promise<unknown> | undefined
      const result = await match.handler({
        req,
        res,
        params: match.params,
        query: url.searchParams,
        ip: req.socket.remoteAddress ?? '',
        body: () => (parsed ??= readJson(req)),
      })
      if (!res.headersSent) sendJson(res, result === undefined ? 204 : 200, result)
    } catch (err) {
      if (res.headersSent) return void res.end()
      if (err instanceof HttpError) sendJson(res, err.status, { error: err.message })
      else {
        console.error(err)
        sendJson(res, 500, { error: 'Something went wrong on the server.' })
      }
    }
  }
}
