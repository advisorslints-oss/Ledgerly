import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from '../server/test-server.ts'
import { addAttachment } from '../src/accounting/attachments'
import { createCompany } from '../src/accounting/company'
import { saveContact } from '../src/accounting/contacts'
import { saveDocument } from '../src/accounting/documents'
import { postEntry } from '../src/accounting/engine'
import { savePayment } from '../src/accounting/payments'
import { runRecurring, saveRecurring } from '../src/accounting/recurring'
import { computeTrialBalance, loadAccounts, loadLines } from '../src/accounting/reports'
import { LedgerDB } from '../src/db/database'
import type { DocLine } from '../src/db/types'
import { newId } from '../src/lib/id'
import { ApiClient } from '../src/sync/api'
import { readMeta, syncOnce, uploadCompany, writeMeta } from '../src/sync/engine'

let srv: TestServer
beforeAll(async () => {
  srv = await startTestServer()
})
afterAll(() => srv.close())

let n = 0
async function account() {
  const api = new ApiClient(srv.base)
  const res = await api.signup('Owner', `owner${++n}-${newId().slice(-6)}@example.test`, 'a long test password')
  return res
}

/** A device: its own local database, signed in to the given account. */
async function device(auth: { token: string; user: { id: string; email: string; name: string } }) {
  const db = new LedgerDB(`device-${newId()}`, `device-${newId()}`)
  await writeMeta(db, { session: { token: auth.token, user: auth.user, server: srv.base } })
  const api = new ApiClient(srv.base, auth.token)
  return { db, api, sync: () => syncOnce(db, api) }
}

/** Balances per account code and document numbers: what should be identical on every device. */
async function books(db: LedgerDB, companyId: string) {
  const accounts = await loadAccounts(db, companyId)
  const tb = computeTrialBalance(accounts, await loadLines(db, companyId))
  expect(tb.totalDebit).toBe(tb.totalCredit)
  const docs = await db.documents.where('companyId').equals(companyId).toArray()
  const entries = await db.journalEntries.where('companyId').equals(companyId).toArray()
  return {
    balances: Object.fromEntries(tb.rows.map((r) => [r.account.code, r.debit - r.credit])),
    documents: docs.map((d) => `${d.number}:${d.status}:${d.total}`).sort(),
    entryNumbers: entries.map((e) => e.number).sort(),
  }
}

async function setupBusiness(db: LedgerDB) {
  const company = await createCompany(db, { name: 'Sync Test Co', country: 'IN', currency: 'INR', industry: 'general', fiscalYearStartMonth: 4, features: { inventory: false, projects: false } })
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray()
  const code = (c: string) => accounts.find((a) => a.code === c)!.id
  return { company, code }
}

const line = (accountId: string, rate: number): DocLine => ({ id: newId(), description: 'Consulting', quantity: 1, rate, accountId })

describe('syncing between devices', () => {
  it('uploads a business with invoices, payments and files, and another device receives all of it', async () => {
    const auth = await account()
    const laptop = await device(auth)
    const { company, code } = await setupBusiness(laptop.db)
    await postEntry(laptop.db, { companyId: company.id, date: '2026-05-01', memo: 'Capital', lines: [{ accountId: code('1010'), debit: 500_000 }, { accountId: code('3000'), credit: 500_000 }] })
    const customer = await saveContact(laptop.db, company.id, { type: 'customer', name: 'Acme' })
    const inv = await saveDocument(laptop.db, company.id, { type: 'invoice', contactId: customer.id, date: '2026-05-02', lines: [line(code('4000'), 120_000)], taxInclusive: false }, { post: true })
    await savePayment(laptop.db, company.id, { direction: 'in', contactId: customer.id, date: '2026-05-05', amount: 120_000, accountId: code('1010'), allocations: [{ documentId: inv.id, amount: 120_000 }] })
    await addAttachment(laptop.db, company.id, inv.id, new File([new Uint8Array([7, 7, 7])], 'receipt.pdf', { type: 'application/pdf' }))

    await uploadCompany(laptop.db, laptop.api, company.id)
    await laptop.sync()

    const phone = await device(auth)
    const meta = await phone.sync()
    expect(meta.synced).toContain(company.id)
    expect(await books(phone.db, company.id)).toEqual(await books(laptop.db, company.id))
    const file = await phone.db.attachments.where('parentId').equals(inv.id).first()
    expect(file?.missing).toBeUndefined()
    expect([...new Uint8Array(await file!.data.arrayBuffer())]).toEqual([7, 7, 7])
  })

  it('merges work done offline on two devices, keeping numbers unique', async () => {
    const auth = await account()
    const laptop = await device(auth)
    const { company, code } = await setupBusiness(laptop.db)
    await uploadCompany(laptop.db, laptop.api, company.id)
    const phone = await device(auth)
    await phone.sync()

    // Both devices are offline and each records a sale and an invoice with the same next numbers.
    const cash = (db: LedgerDB, memo: string) => postEntry(db, { companyId: company.id, date: '2026-06-01', memo, lines: [{ accountId: code('1000'), debit: 10_000 }, { accountId: code('4000'), credit: 10_000 }] })
    const a = await cash(laptop.db, 'Laptop sale')
    const b = await cash(phone.db, 'Phone sale')
    expect(a.number).toBe(b.number)
    const contactOn = async (db: LedgerDB) => saveContact(db, company.id, { type: 'customer', name: `Walk-in ${newId().slice(-4)}` })
    const invA = await saveDocument(laptop.db, company.id, { type: 'invoice', contactId: (await contactOn(laptop.db)).id, date: '2026-06-02', lines: [line(code('4000'), 5_000)], taxInclusive: false }, { post: true })
    const invB = await saveDocument(phone.db, company.id, { type: 'invoice', contactId: (await contactOn(phone.db)).id, date: '2026-06-02', lines: [line(code('4000'), 7_000)], taxInclusive: false }, { post: true })
    expect(invA.number).toBe(invB.number)

    await laptop.sync()
    await phone.sync()
    await laptop.sync()

    const onLaptop = await books(laptop.db, company.id)
    expect(onLaptop).toEqual(await books(phone.db, company.id))
    expect(new Set(onLaptop.entryNumbers).size).toBe(onLaptop.entryNumbers.length)
    expect(onLaptop.documents.map((d) => d.split(':')[0])).toEqual(['INV-0001', 'INV-0002'])
    expect(onLaptop.balances['1000']).toBe(20_000)
    expect((await readMeta(phone.db)).issues).toHaveLength(0)
  })

  it('keeps the first edit when two devices change the same invoice, and tells the other device', async () => {
    const auth = await account()
    const laptop = await device(auth)
    const { company, code } = await setupBusiness(laptop.db)
    const customer = await saveContact(laptop.db, company.id, { type: 'customer', name: 'Acme' })
    const input = (rate: number) => ({ type: 'invoice' as const, contactId: customer.id, date: '2026-05-02', lines: [line(code('4000'), rate)], taxInclusive: false })
    const inv = await saveDocument(laptop.db, company.id, input(100_000), { post: true })
    await uploadCompany(laptop.db, laptop.api, company.id)
    const phone = await device(auth)
    await phone.sync()

    await saveDocument(laptop.db, company.id, input(150_000), { id: inv.id })
    await saveDocument(phone.db, company.id, input(90_000), { id: inv.id })
    await laptop.sync()
    const meta = await phone.sync()

    expect(meta.issues[0]).toMatchObject({ summary: `Invoice ${inv.number}`, reason: expect.stringMatching(/already reversed/) })
    const onPhone = await books(phone.db, company.id)
    expect(onPhone).toEqual(await books(laptop.db, company.id))
    expect(onPhone.balances['1100']).toBe(150_000)
    expect((await phone.db.documents.get(inv.id))!.total).toBe(150_000)
  })

  it('creates each recurring invoice once, even if two devices both run the schedule offline', async () => {
    const auth = await account()
    const laptop = await device(auth)
    const { company, code } = await setupBusiness(laptop.db)
    const customer = await saveContact(laptop.db, company.id, { type: 'customer', name: 'Retainer client' })
    await saveRecurring(laptop.db, company.id, {
      docType: 'invoice',
      template: { contactId: customer.id, lines: [line(code('4000'), 30_000)], taxInclusive: false, dueInDays: 7 },
      every: 1,
      unit: 'month',
      startDate: '2026-03-01',
      autoApprove: true,
    })
    // A draft both devices will approve.
    const draft = await saveDocument(laptop.db, company.id, { type: 'invoice', contactId: customer.id, date: '2026-03-05', lines: [line(code('4000'), 9_000)], taxInclusive: false })
    await uploadCompany(laptop.db, laptop.api, company.id)
    const phone = await device(auth)
    await phone.sync()

    await runRecurring(laptop.db, company.id, '2026-05-15')
    await runRecurring(phone.db, company.id, '2026-05-15')
    const approve = (db: LedgerDB) => saveDocument(db, company.id, { type: 'invoice', contactId: customer.id, date: '2026-03-05', lines: draft.lines, taxInclusive: false }, { id: draft.id, post: true })
    await approve(laptop.db)
    await approve(phone.db)
    await laptop.sync()
    await phone.sync()
    await laptop.sync()

    const onLaptop = await books(laptop.db, company.id)
    expect(onLaptop).toEqual(await books(phone.db, company.id))
    expect(onLaptop.documents).toHaveLength(4)
    expect(onLaptop.balances['1100']).toBe(3 * 30_000 + 9_000)
  })

  it('stops view-only members from changing a shared business', async () => {
    const owner = await account()
    const viewer = await account()
    const laptop = await device(owner)
    const { company, code } = await setupBusiness(laptop.db)
    await uploadCompany(laptop.db, laptop.api, company.id)
    await laptop.api.addMember(company.id, viewer.user.email, 'viewer')

    const theirs = await device(viewer)
    const meta = await theirs.sync()
    expect(meta.roles[company.id]).toBe('viewer')
    theirs.db.readOnlyCompanies = new Set([company.id])
    await expect(
      postEntry(theirs.db, { companyId: company.id, date: '2026-05-01', lines: [{ accountId: code('1010'), debit: 1 }, { accountId: code('3000'), credit: 1 }] }),
    ).rejects.toThrow(/view-only/)
    expect(await theirs.db.journalEntries.count()).toBe(0)
  })
})
