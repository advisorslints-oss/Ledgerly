import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { BatchResult, PullResponse, PushResponse, SyncChange, SyncTable } from '../src/sync/protocol.ts'
import { startTestServer, type TestServer } from './test-server.ts'

type Data = Record<string, unknown>
let srv: TestServer

beforeAll(async () => {
  srv = await startTestServer()
})
afterAll(() => srv.close())

async function call<T = any>(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; body: T }> {
  const res = await fetch(srv.base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: res.status === 204 ? (null as T) : ((await res.json()) as T) }
}

let userCount = 0
async function newUser() {
  const email = `person${++userCount}-${randomUUID().slice(0, 6)}@example.test`
  const res = await call('POST', '/api/auth/signup', { name: `Person ${userCount}`, email, password: 'correct horse battery' })
  expect(res.status).toBe(200)
  return { token: res.body.token as string, id: res.body.user.id as string, email }
}

const put = (tbl: SyncTable, data: Data, fields?: string[]): SyncChange => ({ tbl, id: data.id as string, op: 'put', data, fields })
const batch = (companyId: string, changes: SyncChange[]) => ({ id: randomUUID(), companyId, changes })

async function pushAs(token: string, deviceId: string, batches: ReturnType<typeof batch>[]): Promise<BatchResult[]> {
  const res = await call<PushResponse>('POST', '/api/sync/push', { deviceId, batches }, token)
  expect(res.status).toBe(200)
  return res.body.results
}

function fixtures(companyId = randomUUID()) {
  const company = { id: companyId, name: 'Test Co', nextNumbers: { journal: 1 }, updatedAt: 1 }
  const bank = { id: randomUUID(), companyId, code: '1010', name: 'Bank', type: 'asset', subtype: 'bank', archived: false }
  const sales = { id: randomUUID(), companyId, code: '4000', name: 'Sales', type: 'income', subtype: 'sales', archived: false }
  const entry = (number: string, date: string, amount = 100, extra: Data = {}) => {
    const id = randomUUID()
    return {
      entry: { id, companyId, number, date, memo: `Sale ${number}`, source: 'manual', status: 'posted', total: amount, createdAt: Date.now(), ...extra },
      lines: [
        { id: randomUUID(), companyId, entryId: id, accountId: bank.id, date, debit: amount, credit: 0, order: 0 },
        { id: randomUUID(), companyId, entryId: id, accountId: sales.id, date, debit: 0, credit: amount, order: 1 },
      ],
    }
  }
  const entryChanges = (e: ReturnType<typeof entry>) => [put('journalEntries', e.entry), ...e.lines.map((l) => put('journalLines', l))]
  return { companyId, company, bank, sales, entry, entryChanges, setup: batch(companyId, [put('companies', company), put('accounts', bank), put('accounts', sales)]) }
}

describe('accounts and sessions', () => {
  it('signs up, signs in, rejects bad passwords and ends sessions', async () => {
    const email = `owner-${randomUUID().slice(0, 6)}@example.test`
    const signup = await call('POST', '/api/auth/signup', { name: 'Owner', email, password: 'a strong password' })
    expect(signup.status).toBe(200)
    expect((await call('POST', '/api/auth/signup', { name: 'Again', email, password: 'a strong password' })).status).toBe(409)
    expect((await call('POST', '/api/auth/signup', { name: 'Short', email: `x${email}`, password: 'short' })).status).toBe(400)
    expect((await call('POST', '/api/auth/login', { email, password: 'wrong password' })).status).toBe(401)

    const login = await call('POST', '/api/auth/login', { email: email.toUpperCase(), password: 'a strong password' })
    expect(login.status).toBe(200)
    expect((await call('GET', '/api/auth/me', undefined, login.body.token)).body.user.email).toBe(email)
    await call('POST', '/api/auth/logout', undefined, login.body.token)
    expect((await call('GET', '/api/auth/me', undefined, login.body.token)).status).toBe(401)
    expect((await call('GET', '/api/sync/pull?since=0', undefined, 'not-a-token')).status).toBe(401)
  })
})

describe('push and pull', () => {
  it('shares changes between devices of the same account, and with nobody else', async () => {
    const owner = await newUser()
    const stranger = await newUser()
    const fx = fixtures()
    const sale = fx.entry('JE-0001', '2026-05-01')
    const [r1, r2] = await pushAs(owner.token, 'device-a', [fx.setup, batch(fx.companyId, fx.entryChanges(sale))])
    expect(r1.ok && r2.ok).toBe(true)

    const fromB = await call<PullResponse>('GET', '/api/sync/pull?since=0&device=device-b', undefined, owner.token)
    expect(fromB.body.changes.filter((c) => c.companyId === fx.companyId)).toHaveLength(6)
    expect(fromB.body.companies.map((c) => c.id)).toContain(fx.companyId)
    // A doesn't get its own changes back, only what the server changed (here, the bumped entry counter).
    const fromA = await call<PullResponse>('GET', '/api/sync/pull?since=0&device=device-a', undefined, owner.token)
    expect(fromA.body.changes.map((c) => c.tbl)).toEqual(['companies'])

    const theirs = await call<PullResponse>('GET', '/api/sync/pull?since=0', undefined, stranger.token)
    expect(theirs.body.changes).toHaveLength(0)
    expect((await call('GET', `/api/companies/${fx.companyId}/snapshot`, undefined, stranger.token)).status).toBe(404)
    const [rejected] = await pushAs(stranger.token, 'device-x', [batch(fx.companyId, [put('companies', { ...fx.company, name: 'Hijacked' })])])
    expect(rejected).toMatchObject({ ok: false, reason: expect.stringMatching(/don't have access/) })
  })

  it('renumbers entries and invoices that two devices numbered the same offline', async () => {
    const owner = await newUser()
    const fx = fixtures()
    await pushAs(owner.token, 'a', [fx.setup])
    const fromA = fx.entry('JE-0001', '2026-05-01')
    const fromB = fx.entry('JE-0001', '2026-05-02')
    const audit = { id: randomUUID(), companyId: fx.companyId, at: 1, action: 'post', entity: 'journalEntry', entityId: fromB.entry.id, summary: 'Posted JE-0001 · Sale' }
    await pushAs(owner.token, 'a', [batch(fx.companyId, fx.entryChanges(fromA))])
    const [res] = await pushAs(owner.token, 'b', [batch(fx.companyId, [...fx.entryChanges(fromB), put('audit', audit)])])
    if (!res.ok) throw new Error(res.reason)
    expect(res.rewritten.find((r) => r.id === fromB.entry.id)?.data?.number).toBe('JE-0002')
    expect(res.rewritten.find((r) => r.id === audit.id)?.data?.summary).toBe('Posted JE-0002 · Sale')
    expect((res.rewritten.find((r) => r.tbl === 'companies')?.data?.nextNumbers as Data).journal).toBe(3)

    const invoice = (number: string) => ({ id: randomUUID(), companyId: fx.companyId, type: 'invoice', number, status: 'draft', date: '2026-05-01', lines: [], total: 0 })
    const invA = invoice('INV-0007')
    const invB = invoice('INV-0007')
    await pushAs(owner.token, 'a', [batch(fx.companyId, [put('documents', invA)])])
    const [inv] = await pushAs(owner.token, 'b', [batch(fx.companyId, [put('documents', invB)])])
    if (!inv.ok) throw new Error(inv.reason)
    expect(inv.rewritten.find((r) => r.id === invB.id)?.data?.number).toBe('INV-0008')
    // A later, stale copy from device B still says INV-0007; the server keeps INV-0008.
    const [stale] = await pushAs(owner.token, 'b', [batch(fx.companyId, [put('documents', { ...invB, status: 'posted' })])])
    if (!stale.ok) throw new Error(stale.reason)
    expect(stale.rewritten.find((r) => r.id === invB.id)?.data).toMatchObject({ number: 'INV-0008', status: 'posted' })
  })

  it('refuses a second reversal of the same entry from another device', async () => {
    const owner = await newUser()
    const fx = fixtures()
    const original = fx.entry('JE-0001', '2026-05-01')
    await pushAs(owner.token, 'a', [fx.setup, batch(fx.companyId, fx.entryChanges(original))])
    const reversal = (number: string) => {
      const r = fx.entry(number, '2026-05-03', 100, { source: 'reversal', reversalOfId: original.entry.id })
      r.lines = r.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }))
      return r
    }
    const r1 = reversal('JE-0002')
    const r2 = reversal('JE-0002')
    const marked = (r: ReturnType<typeof reversal>) => put('journalEntries', { ...original.entry, status: 'reversed', reversedById: r.entry.id }, ['status', 'reversedById', 'updatedAt'])
    const [ok] = await pushAs(owner.token, 'a', [batch(fx.companyId, [...fx.entryChanges(r1), marked(r1)])])
    expect(ok.ok).toBe(true)
    const [no] = await pushAs(owner.token, 'b', [batch(fx.companyId, [...fx.entryChanges(r2), marked(r2)])])
    expect(no).toMatchObject({ ok: false, reason: expect.stringMatching(/already reversed/) })
    if (no.ok) return
    expect(no.current.find((r) => r.id === original.entry.id)?.data?.reversedById).toBe(r1.entry.id)
    expect(no.current.find((r) => r.id === r2.entry.id)?.data).toBeNull()
  })

  it('enforces lock dates, balanced entries and lines belonging to their entry', async () => {
    const owner = await newUser()
    const fx = fixtures()
    await pushAs(owner.token, 'a', [fx.setup, batch(fx.companyId, [put('companies', { ...fx.company, lockDate: '2026-05-31' }, ['lockDate'])])])
    const locked = await pushAs(owner.token, 'b', [batch(fx.companyId, fx.entryChanges(fx.entry('JE-0001', '2026-05-15')))])
    expect(locked[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/locked/) })

    const lopsided = fx.entry('JE-0001', '2026-06-02')
    lopsided.lines[1].credit = 90
    expect((await pushAs(owner.token, 'b', [batch(fx.companyId, fx.entryChanges(lopsided))]))[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/doesn't balance/) })

    const good = fx.entry('JE-0001', '2026-06-02')
    await pushAs(owner.token, 'b', [batch(fx.companyId, fx.entryChanges(good))])
    const extra = { ...good.lines[0], id: randomUUID() }
    expect((await pushAs(owner.token, 'b', [batch(fx.companyId, [put('journalLines', extra)])]))[0]).toMatchObject({ ok: false })

    const del = await pushAs(owner.token, 'b', [batch(fx.companyId, [{ tbl: 'accounts', id: fx.bank.id, op: 'delete' }])])
    expect(del[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/has transactions/) })
  })
})

describe('team access and files', () => {
  it('invites people with roles and blocks view-only changes', async () => {
    const owner = await newUser()
    const helper = await newUser()
    const fx = fixtures()
    await pushAs(owner.token, 'a', [fx.setup])

    expect((await call('POST', `/api/companies/${fx.companyId}/members`, { email: 'nobody@example.test', role: 'viewer' }, owner.token)).status).toBe(404)
    const invite = await call('POST', `/api/companies/${fx.companyId}/members`, { email: helper.email, role: 'viewer' }, owner.token)
    expect(invite.body.members).toHaveLength(2)
    expect((await call('POST', `/api/companies/${fx.companyId}/members`, { email: helper.email, role: 'viewer' }, helper.token)).status).toBe(403)

    const pulled = await call<PullResponse>('GET', '/api/sync/pull?since=0', undefined, helper.token)
    expect(pulled.body.companies).toEqual([{ id: fx.companyId, name: 'Test Co', role: 'viewer' }])
    const [blocked] = await pushAs(helper.token, 'h', [batch(fx.companyId, [put('accounts', { ...fx.bank, name: 'Renamed' }, ['name'])])])
    expect(blocked).toMatchObject({ ok: false, reason: expect.stringMatching(/view-only/) })

    await call('PATCH', `/api/companies/${fx.companyId}/members/${helper.id}`, { role: 'editor' }, owner.token)
    const [allowed] = await pushAs(helper.token, 'h', [batch(fx.companyId, [put('accounts', { ...fx.bank, name: 'Renamed' }, ['name'])])])
    expect(allowed.ok).toBe(true)

    expect((await call('DELETE', `/api/companies/${fx.companyId}/members/${owner.id}`, undefined, helper.token)).status).toBe(403)
    expect((await call('DELETE', `/api/companies/${fx.companyId}/members/${helper.id}`, undefined, helper.token)).status).toBe(204)
    expect((await call<PullResponse>('GET', '/api/sync/pull?since=0', undefined, helper.token)).body.companies).toHaveLength(0)
  })

  it('stores attachment files for members only, and deletes businesses for the owner only', async () => {
    const owner = await newUser()
    const stranger = await newUser()
    const fx = fixtures()
    await pushAs(owner.token, 'a', [fx.setup])
    const fileId = randomUUID()
    const up = await fetch(`${srv.base}/api/files/${fileId}?company=${fx.companyId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'image/png' },
      body: new Uint8Array([1, 2, 3, 4]),
    })
    expect(up.status).toBe(200)
    const down = await fetch(`${srv.base}/api/files/${fileId}`, { headers: { Authorization: `Bearer ${owner.token}` } })
    expect(down.headers.get('content-type')).toBe('image/png')
    expect([...new Uint8Array(await down.arrayBuffer())]).toEqual([1, 2, 3, 4])
    expect((await fetch(`${srv.base}/api/files/${fileId}`, { headers: { Authorization: `Bearer ${stranger.token}` } })).status).toBe(404)

    expect((await call('DELETE', `/api/companies/${fx.companyId}`, undefined, stranger.token)).status).toBe(404)
    expect((await call('DELETE', `/api/companies/${fx.companyId}`, undefined, owner.token)).status).toBe(204)
    const after = await call<PullResponse>('GET', '/api/sync/pull?since=0', undefined, owner.token)
    expect(after.body.deletedCompanies).toContain(fx.companyId)
    expect(after.body.companies.map((c) => c.id)).not.toContain(fx.companyId)
  })
})
