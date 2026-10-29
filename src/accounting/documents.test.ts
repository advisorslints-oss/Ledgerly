import { describe, expect, it } from 'vitest'
import type { DocLine, TaxRate } from '../db/types'
import { newId } from '../lib/id'
import { setLockDate, updateCompany } from './company'
import { saveContact } from './contacts'
import { applyCredit, computeTotals, convertDocument, docState, saveDocument, settledAmounts, voidDocument } from './documents'
import { adjustStock, saveItem, stockLevels } from './items'
import { savePayment, voidPayment } from './payments'
import { computeTrialBalance, loadAccounts, loadLines, naturalBalance, totalsByAccount } from './reports'
import { freshDb, setupCompany } from './test-helpers'

const line = (accountId: string, quantity: number, rate: number, extra: Partial<DocLine> = {}): DocLine => ({ id: newId(), description: 'Item', quantity, rate, accountId, ...extra })

async function balances(db: ReturnType<typeof freshDb>, companyId: string) {
  const accounts = await loadAccounts(db, companyId)
  const lines = await loadLines(db, companyId)
  const totals = totalsByAccount(lines)
  const tb = computeTrialBalance(accounts, lines)
  expect(tb.totalDebit).toBe(tb.totalCredit)
  return (code: string) => {
    const a = accounts.find((x) => x.code === code)!
    return naturalBalance(a.type, totals.get(a.id) ?? { debit: 0, credit: 0 })
  }
}

async function setup(inventory = false) {
  const db = freshDb()
  const ctx = await setupCompany(db, { features: { inventory, projects: false } })
  const rates = await db.taxRates.where('companyId').equals(ctx.company.id).toArray()
  const gst18 = rates.find((r) => r.name === 'GST 18%')!
  const customer = await saveContact(db, ctx.company.id, { type: 'customer', name: 'Acme Corp', paymentTermsDays: 30 })
  const supplier = await saveContact(db, ctx.company.id, { type: 'supplier', name: 'Parts Ltd' })
  return { db, ...ctx, gst18, customer, supplier }
}

describe('computeTotals', () => {
  const rate: TaxRate = {
    id: 't',
    companyId: 'c',
    name: 'GST 18%',
    rate: 18,
    archived: false,
    createdAt: 0,
    updatedAt: 0,
    components: [
      { name: 'CGST', rate: 9, salesAccountId: 'cgst' },
      { name: 'SGST', rate: 9, salesAccountId: 'sgst' },
    ],
  }
  const rates = new Map([['t', rate]])

  it('adds tax on top, split into components', () => {
    const t = computeTotals([{ id: 'a', quantity: 3, rate: 10_000, taxRateId: 't' }], rates, false, 'sales')
    expect(t.subtotal).toBe(30_000)
    expect(t.taxTotal).toBe(5_400)
    expect(t.total).toBe(35_400)
    expect(t.taxes.map((x) => [x.name, x.amount, x.accountId])).toEqual([
      ['CGST', 2_700, 'cgst'],
      ['SGST', 2_700, 'sgst'],
    ])
  })

  it('backs tax out of tax-inclusive prices', () => {
    const t = computeTotals([{ id: 'a', quantity: 1, rate: 11_800, taxRateId: 't' }], rates, true, 'sales')
    expect(t.total).toBe(11_800)
    expect(t.subtotal).toBe(10_000)
    expect(t.taxTotal).toBe(1_800)
  })

  it('applies discounts and fractional quantities', () => {
    const t = computeTotals([{ id: 'a', quantity: 1.5, rate: 2_000, discountPct: 10 }], rates, false, 'sales')
    expect(t.total).toBe(2_700)
  })
})

describe('invoices and payments', () => {
  it('posts an invoice to receivables, income and tax', async () => {
    const { db, company, byCode, gst18, customer } = await setup()
    const inv = await saveDocument(
      db,
      company.id,
      { type: 'invoice', contactId: customer.id, date: '2026-05-01', dueDate: '2026-05-31', lines: [line(byCode('4000'), 2, 50_000, { taxRateId: gst18.id })], taxInclusive: false },
      { post: true },
    )
    expect(inv.number).toBe('INV-0001')
    expect(inv.total).toBe(118_000)
    const bal = await balances(db, company.id)
    expect(bal('1100')).toBe(118_000)
    expect(bal('4000')).toBe(100_000)
    expect(bal('2210')).toBe(9_000)
    expect(bal('2211')).toBe(9_000)
    expect(docState(inv, 0, '2026-05-10')).toBe('unpaid')
    expect(docState(inv, 0, '2026-06-01')).toBe('overdue')
  })

  it('drafts do not touch the books, and editing a posted invoice replaces its entry', async () => {
    const { db, company, byCode, customer } = await setup()
    const draft = await saveDocument(db, company.id, { type: 'invoice', contactId: customer.id, date: '2026-05-01', lines: [line(byCode('4000'), 1, 10_000)], taxInclusive: false })
    expect(draft.status).toBe('draft')
    expect(await db.journalEntries.count()).toBe(0)

    const posted = await saveDocument(db, company.id, { type: 'invoice', contactId: customer.id, date: '2026-05-01', lines: [line(byCode('4000'), 1, 10_000)], taxInclusive: false }, { id: draft.id, post: true })
    const edited = await saveDocument(db, company.id, { type: 'invoice', contactId: customer.id, date: '2026-05-02', lines: [line(byCode('4000'), 3, 10_000)], taxInclusive: false }, { id: posted.id })
    expect(edited.status).toBe('posted')
    expect(edited.entryId).not.toBe(posted.entryId)
    const bal = await balances(db, company.id)
    expect(bal('1100')).toBe(30_000)
    expect(bal('4000')).toBe(30_000)
    expect((await db.journalEntries.get(posted.entryId!))!.status).toBe('reversed')
  })

  it('settles invoices with payments, partially and fully', async () => {
    const { db, company, byCode, customer } = await setup()
    const inv = await saveDocument(db, company.id, { type: 'invoice', contactId: customer.id, date: '2026-05-01', lines: [line(byCode('4000'), 1, 10_000)], taxInclusive: false }, { post: true })
    const bank = byCode('1010')
    await expect(savePayment(db, company.id, { direction: 'in', contactId: customer.id, date: '2026-05-05', amount: 12_000, accountId: bank, allocations: [{ documentId: inv.id, amount: 12_000 }] })).rejects.toThrow(/more than is left/)

    const p1 = await savePayment(db, company.id, { direction: 'in', contactId: customer.id, date: '2026-05-05', amount: 4_000, accountId: bank, allocations: [{ documentId: inv.id, amount: 4_000 }] })
    let settled = settledAmounts(await db.documents.toArray(), await db.payments.toArray())
    expect(docState(inv, settled.get(inv.id) ?? 0, '2026-05-06')).toBe('partial')

    await savePayment(db, company.id, { direction: 'in', contactId: customer.id, date: '2026-05-09', amount: 6_000, accountId: bank, allocations: [{ documentId: inv.id, amount: 6_000 }] })
    settled = settledAmounts(await db.documents.toArray(), await db.payments.toArray())
    expect(docState(inv, settled.get(inv.id) ?? 0)).toBe('paid')
    let bal = await balances(db, company.id)
    expect(bal('1100')).toBe(0)
    expect(bal('1010')).toBe(10_000)

    await expect(voidDocument(db, inv.id)).rejects.toThrow(/has payments/)
    await voidPayment(db, p1.id)
    bal = await balances(db, company.id)
    expect(bal('1100')).toBe(4_000)
    expect(p1.number).toBe('RCPT-0001')
  })

  it('applies a credit note to an invoice', async () => {
    const { db, company, byCode, customer } = await setup()
    const inv = await saveDocument(db, company.id, { type: 'invoice', contactId: customer.id, date: '2026-05-01', lines: [line(byCode('4000'), 1, 10_000)], taxInclusive: false }, { post: true })
    const cn = await saveDocument(db, company.id, { type: 'credit_note', contactId: customer.id, date: '2026-05-03', lines: [line(byCode('4000'), 1, 2_500)], taxInclusive: false }, { post: true })
    await applyCredit(db, cn.id, [{ documentId: inv.id, amount: 2_500 }])
    const settled = settledAmounts(await db.documents.toArray(), await db.payments.toArray())
    expect(settled.get(inv.id)).toBe(2_500)
    const bal = await balances(db, company.id)
    expect(bal('1100')).toBe(7_500)
    expect(bal('4000')).toBe(7_500)
    await expect(voidDocument(db, cn.id)).rejects.toThrow(/Remove the credit/)
  })

  it('refuses to change a posted invoice in a locked period', async () => {
    const { db, company, byCode, customer } = await setup()
    const inv = await saveDocument(db, company.id, { type: 'invoice', contactId: customer.id, date: '2026-05-01', lines: [line(byCode('4000'), 1, 10_000)], taxInclusive: false }, { post: true })
    await setLockDate(db, company.id, '2026-05-31')
    await expect(saveDocument(db, company.id, { type: 'invoice', contactId: customer.id, date: '2026-06-02', lines: [line(byCode('4000'), 1, 9_000)], taxInclusive: false }, { id: inv.id })).rejects.toMatchObject({ code: 'locked' })
    await expect(voidDocument(db, inv.id)).rejects.toMatchObject({ code: 'locked' })
  })

  it('converts a quote into a draft invoice', async () => {
    const { db, company, byCode, customer } = await setup()
    const quote = await saveDocument(db, company.id, { type: 'quote', contactId: customer.id, date: '2026-05-01', lines: [line(byCode('4000'), 2, 5_000)], taxInclusive: false })
    expect(await db.journalEntries.count()).toBe(0)
    const inv = await convertDocument(db, quote.id)
    expect(inv.type).toBe('invoice')
    expect(inv.status).toBe('draft')
    expect(inv.total).toBe(10_000)
    expect((await db.documents.get(quote.id))!.status).toBe('converted')
  })
})

describe('purchases and stock', () => {
  it('buys stock into inventory and moves cost to cost of sales when sold', async () => {
    const { db, company, byCode, customer, supplier } = await setup(true)
    const widget = await saveItem(db, company.id, { kind: 'product', name: 'Widget', salePrice: 2_500, purchasePrice: 1_000, trackStock: true })
    await saveDocument(db, company.id, { type: 'bill', contactId: supplier.id, date: '2026-05-01', lines: [line(byCode('5000'), 10, 1_000, { itemId: widget.id })], taxInclusive: false }, { post: true })
    await saveDocument(db, company.id, { type: 'bill', contactId: supplier.id, date: '2026-05-02', lines: [line(byCode('5000'), 10, 1_300, { itemId: widget.id })], taxInclusive: false }, { post: true })
    await saveDocument(db, company.id, { type: 'invoice', contactId: customer.id, date: '2026-05-05', lines: [line(byCode('4000'), 4, 2_500, { itemId: widget.id })], taxInclusive: false }, { post: true })

    const level = stockLevels(await db.stockMoves.toArray()).get(widget.id)!
    expect(level.quantity).toBe(16)
    expect(level.value).toBe(23_000 - 4_600)
    const bal = await balances(db, company.id)
    expect(bal('1200')).toBe(level.value)
    expect(bal('5000')).toBe(4_600) // 4 units at the 1,150 average
    expect(bal('2000')).toBe(23_000)

    await adjustStock(db, company.id, { itemId: widget.id, date: '2026-05-06', quantity: -1, accountId: byCode('5000'), reason: 'Damaged' })
    const after = stockLevels(await db.stockMoves.toArray()).get(widget.id)!
    expect(after.quantity).toBe(15)
    expect((await balances(db, company.id))('1200')).toBe(after.value)
  })

  it('adds tax that cannot be claimed back to the cost', async () => {
    const { db, company, byCode, supplier } = await setup()
    const rates = await db.taxRates.where('companyId').equals(company.id).toArray()
    const claimable = rates.find((r) => r.name === 'GST 18%')!
    await saveDocument(db, company.id, { type: 'bill', contactId: supplier.id, date: '2026-05-01', lines: [line(byCode('6040'), 1, 10_000, { taxRateId: claimable.id })], taxInclusive: false }, { post: true })
    let bal = await balances(db, company.id)
    expect(bal('6040')).toBe(10_000)
    expect(bal('1360') + bal('1361')).toBe(1_800)

    await updateCompany(db, company.id, {})
    const noClaim = { ...claimable, components: claimable.components.map((c) => ({ ...c, purchaseAccountId: undefined })) }
    await db.taxRates.put(noClaim)
    await saveDocument(db, company.id, { type: 'bill', contactId: supplier.id, date: '2026-05-02', lines: [line(byCode('6040'), 1, 10_000, { taxRateId: claimable.id })], taxInclusive: false }, { post: true })
    bal = await balances(db, company.id)
    expect(bal('6040')).toBe(10_000 + 11_800)
  })

  it('records an expense paid straight from the bank', async () => {
    const { db, company, byCode } = await setup()
    const exp = await saveDocument(db, company.id, { type: 'expense', date: '2026-05-01', lines: [line(byCode('6070'), 1, 4_500)], taxInclusive: false, paidFromAccountId: byCode('1010') }, { post: true })
    expect(exp.number).toBe('EXP-0001')
    const bal = await balances(db, company.id)
    expect(bal('1010')).toBe(-4_500)
    expect(bal('6070')).toBe(4_500)
    expect(bal('2000')).toBe(0)
  })
})
