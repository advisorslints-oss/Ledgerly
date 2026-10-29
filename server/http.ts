import type { IncomingMessage, ServerResponse } from 'node:http'

export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface Ctx {
  req: IncomingMessage
  res: ServerResponse
  params: Record<string, string>
  query: URLSearchParams
  ip: string
  body: () => Promise<unknown>
}

export type Handler = (ctx: Ctx) => unknown | Promise<unknown>

interface Route {
  method: string
  pattern: RegExp
  keys: string[]
  handler: Handler
}

export class Router {
  private routes: Route[] = []

  add(method: string, path: string, handler: Handler): void {
    const keys: string[] = []
    const pattern = new RegExp(
      '^' +
        path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
          keys.push(key)
          return '([^/]+)'
        }) +
        '$',
    )
    this.routes.push({ method, pattern, keys, handler })
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | 'method' | null {
    let pathMatched = false
    for (const route of this.routes) {
      const m = route.pattern.exec(path)
      if (!m) continue
      pathMatched = true
      if (route.method !== method) continue
      const params: Record<string, string> = {}
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])))
      return { handler: route.handler, params }
    }
    return pathMatched ? 'method' : null
  }
}

const MAX_BODY = 25 * 1024 * 1024

export function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request is too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new HttpError(400, 'Request body must be JSON.'))
      }
    })
    req.on('error', reject)
  })
}

export function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new HttpError(413, 'Files can be up to 10 MB.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export function setCors(res: ServerResponse): void {
  // Auth uses a bearer token, never cookies, so allowing any origin doesn't expose sessions.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Max-Age', '86400')
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (status === 204 || body === undefined) {
    res.writeHead(status === 200 ? 204 : status).end()
    return
  }
  const json = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(json)
}

/** Fixed-window limiter for login and signup attempts. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()
  private limit: number
  private windowMs: number

  constructor(limit: number, windowMs: number) {
    this.limit = limit
    this.windowMs = windowMs
  }

  check(key: string): void {
    const now = Date.now()
    const hit = this.hits.get(key)
    if (!hit || hit.resetAt < now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
      return
    }
    hit.count++
    if (hit.count > this.limit) throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.')
  }
}

// Small typed readers for request bodies.
export function str(body: unknown, key: string, opts: { min?: number; max?: number } = {}): string {
  const value = (body as Record<string, unknown> | null)?.[key]
  if (typeof value !== 'string') throw new HttpError(400, `${key} is required.`)
  const v = value.trim()
  if (v.length < (opts.min ?? 1)) throw new HttpError(400, `${key} is too short.`)
  if (v.length > (opts.max ?? 200)) throw new HttpError(400, `${key} is too long.`)
  return v
}
