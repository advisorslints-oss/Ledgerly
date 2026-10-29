import type { AuthResponse, CompanyAccess, Member, PublicUser, PullResponse, PushRequest, PushResponse, Role, SnapshotResponse } from './protocol'

/** status 0 means the server couldn't be reached at all (offline, wrong address, server down). */
export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export class ApiClient {
  readonly server: string
  token?: string

  /** `server` is the sync server's address; empty means the same address the app was loaded from. */
  constructor(server: string, token?: string) {
    this.server = server.trim().replace(/\/+$/, '')
    this.token = token
  }

  private url(path: string) {
    return `${this.server}/api${path}`
  }

  private async send(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response
    try {
      res = await fetch(this.url(path), {
        method,
        ...init,
        headers: { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(init.headers as Record<string, string> | undefined) },
      })
    } catch {
      throw new ApiError(0, "Can't reach the sync server. Check your internet connection.")
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new ApiError(res.status, body.error ?? `The server answered with an error (${res.status}).`)
    }
    return res
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.send(method, path, body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
    return (res.status === 204 ? undefined : await res.json()) as T
  }

  signup(name: string, email: string, password: string) {
    return this.request<AuthResponse>('POST', '/auth/signup', { name, email, password })
  }
  login(email: string, password: string) {
    return this.request<AuthResponse>('POST', '/auth/login', { email, password })
  }
  logout() {
    return this.request<void>('POST', '/auth/logout')
  }
  me() {
    return this.request<{ user: PublicUser }>('GET', '/auth/me')
  }
  companies() {
    return this.request<{ companies: CompanyAccess[] }>('GET', '/companies')
  }
  snapshot(companyId: string) {
    return this.request<SnapshotResponse>('GET', `/companies/${encodeURIComponent(companyId)}/snapshot`)
  }
  deleteCompany(companyId: string) {
    return this.request<void>('DELETE', `/companies/${encodeURIComponent(companyId)}`)
  }
  members(companyId: string) {
    return this.request<{ members: Member[] }>('GET', `/companies/${encodeURIComponent(companyId)}/members`)
  }
  addMember(companyId: string, email: string, role: Exclude<Role, 'owner'>) {
    return this.request<{ members: Member[] }>('POST', `/companies/${encodeURIComponent(companyId)}/members`, { email, role })
  }
  updateMember(companyId: string, userId: string, role: Exclude<Role, 'owner'>) {
    return this.request<{ members: Member[] }>('PATCH', `/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}`, { role })
  }
  removeMember(companyId: string, userId: string) {
    return this.request<void>('DELETE', `/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}`)
  }
  push(body: PushRequest) {
    return this.request<PushResponse>('POST', '/sync/push', body)
  }
  pull(since: number, deviceId: string) {
    return this.request<PullResponse>('GET', `/sync/pull?since=${since}&device=${encodeURIComponent(deviceId)}`)
  }
  async uploadFile(id: string, companyId: string, data: Blob): Promise<void> {
    await this.send('PUT', `/files/${encodeURIComponent(id)}?company=${encodeURIComponent(companyId)}`, { body: data, headers: { 'Content-Type': data.type || 'application/octet-stream' } })
  }
  async downloadFile(id: string): Promise<Blob> {
    const res = await this.send('GET', `/files/${encodeURIComponent(id)}`)
    return res.blob()
  }
}
