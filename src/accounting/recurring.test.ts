import { describe, expect, it } from 'vitest'
import type { DocLine } from '../db/types'
import { newId } from '../lib/id'
import { setLockDate } from './company'
import { saveContact } from './contacts'
import { saveDocument, settledAmounts } from './documents'
import { createNextNow, describeSchedule, nextDate, occurrenceDate, runRecurring, saveRecurring, setRecurringPaused } from './recurring'
import { DEFAULT_REMINDERS, dueReminders, logReminder, renderReminder, stageLabel } from './reminders'
import { computeTrialBalance, loadAccounts, loadLines } from './reports'
import { freshDb, setupCompany } from './test-helpers'

const line = (accountId: string, rate: number): DocLine => ({ id: newId(), description: 'Monthly retainer', quantity: 1, rate, accountId })

async function setup() {
  const db = freshDb()
  const ctx = await setupCompany(db)
  const customer = await saveContact(db, ctx.company.id, { type: 'customer', name: 'Acme' })
  const schedule = (extra: Partial<Parameters<typeof saveRecurring>[2]> = {}) =>
    saveRecurring(db, ctx.company.id, {
      docType: 'invoice',
      template: { contactId: customer.id, lines: [line(ctx.byCode('4000'), 50_000)], taxInclusive: false, dueInDays: 15 },
      every: 1,
      unit: 'month',
      startDate: '2026-01-31',
      autoApprove: true,
      ...extra,
    })
  const invoices = async () => (await db.documents.toArray()).filter((d) => d.type === 'invoice').sort((a, b) => a.date.localeCompare(b.date))
  return { db, ...ctx, customer, schedule, invoices }
}

describe('schedule dates', () => {
  it("counts from the start so month ends don't drift", () => {
    const r = { startDate: '2026-01-31', every: 1, unit: 'month' as const }
    expect([0, 1, 2, 3].map((i) => occurrenceDate(r, i))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    expect(occurrenceDate({ startDate: '2026-05-04', every: 2, unit: 'week' }, 3)).toBe('2026-06-15')
    expect(occurrenceDate({ startDate: '2026-04-01', every: 1, unit: 'quarter' }, 2)).toBe('2026-10-01')
    expect(occurrenceDate({ startDate: '2024-02-29', every: 1, unit: 'year' }, 1)).toBe('2025-02-28')
    expect(describeSchedule({ every: 1, unit: 'month' })).toBe('Every month')
    expect(describeSchedule({ every: 2, unit: 'week' })).toBe('Every 2 weeks')
  })
})

describe('running schedules', () => {
  it('catches up on missed invoices, posts them, and never repeats one', async () => {
    const { db, company, schedule, invoices } = await setup()
    const r = await schedule()
    const made = await runRecurring(db, company.id, '2026-04-30')
    expect(made.map((d) => d.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    expect(made.every((d) => d.status === 'posted' && d.recurringId === r.id)).toBe(true)
    expect(made[0].dueDate).toBe('2026-02-15')
    expect(await runRecurring(db, company.id, '2026-04-30')).toHaveLength(0)
    expect(nextDate((await db.recurring.get(r.id))!)).toBe('2026-05-31')

    const tb = computeTrialBalance(await loadAccounts(db, company.id), await loadLines(db, company.id))
    expect(tb.totalDebit).toBe(tb.totalCredit)
    expect(tb.rows.find((x) => x.account.code === '1100')?.debit).toBe(200_000)
    expect((await invoices()).map((d) => d.number)).toEqual(['INV-0001', 'INV-0002', 'INV-0003', 'INV-0004'])
  })

  it('stops after the chosen number of times or end date', async () => {
    const { db, company, schedule } = await setup()
    const byCount = await schedule({ maxCount: 2 })
    const byDate = await schedule({ startDate: '2026-01-10', endDate: '2026-02-20', name: 'Until February' })
    await runRecurring(db, company.id, '2026-12-31')
    expect((await db.recurring.get(byCount.id))!).toMatchObject({ status: 'ended', createdCount: 2 })
    expect((await db.recurring.get(byDate.id))!).toMatchObject({ status: 'ended', createdCount: 2 })
    expect(nextDate((await db.recurring.get(byCount.id))!)).toBeUndefined()
  })

  it('creates drafts when not set to approve, and skips dates missed while paused', async () => {
    const { db, company, schedule, invoices } = await setup()
    const r = await schedule({ autoApprove: false, startDate: '2020-01-01' })
    await setRecurringPaused(db, r.id, true)
    expect(await runRecurring(db, company.id)).toHaveLength(0)
    await setRecurringPaused(db, r.id, false)
    const resumed = (await db.recurring.get(r.id))!
    expect(occurrenceDate(resumed, resumed.nextIndex) >= new Date().toISOString().slice(0, 8)).toBe(true)
    const now = await createNextNow(db, r.id)
    expect(now?.status).toBe('draft')
    expect((await invoices()).length).toBe(1)
    expect(await db.journalEntries.count()).toBe(0)
  })

  it('keeps a document as a draft when it lands in a locked period', async () => {
    const { db, company, schedule } = await setup()
    await setLockDate(db, company.id, '2026-02-28')
    await schedule()
    const made = await runRecurring(db, company.id, '2026-03-31')
    expect(made.map((d) => d.status)).toEqual(['draft', 'draft', 'posted'])
  })
})

describe('payment reminders', () => {
  it('asks for the latest stage reached, once per stage', async () => {
    const { db, company, byCode, customer } = await setup()
    const inv = await saveDocument(db, company.id, { type: 'invoice', contactId: customer.id, date: '2026-05-01', dueDate: '2026-05-31', lines: [line(byCode('4000'), 10_000)], taxInclusive: false }, { post: true })
    const settings = DEFAULT_REMINDERS
    const check = async (asOf: string) => dueReminders(await db.documents.toArray(), settledAmounts(await db.documents.toArray(), await db.payments.toArray()), await db.reminders.toArray(), settings, asOf)

    expect(await check('2026-05-20')).toHaveLength(0)
    const before = await check('2026-05-29')
    expect(before[0]).toMatchObject({ stageIndex: 0, daysOverdue: -2 })
    await logReminder(db, inv, before[0].stageIndex, 'whatsapp')
    expect(await check('2026-05-30')).toHaveLength(0)
    expect((await check('2026-06-02'))[0].stageIndex).toBe(1)
    // Three weeks late with nothing sent since: only the final reminder is due.
    expect((await check('2026-06-25'))[0]).toMatchObject({ stageIndex: 3, stage: { tone: 'final' }, daysOverdue: 25 })
    expect(stageLabel(-3)).toBe('3 days before due')
    expect(stageLabel(14)).toBe('2 weeks overdue')
  })

  it('fills in the message', () => {
    const text = renderReminder(DEFAULT_REMINDERS.templates.firm, {
      customer: 'Acme',
      number: 'INV-0007',
      amount: '₹1,180.00',
      dueDate: '31 May 2026',
      daysOverdue: 9,
      business: 'Sunrise Traders',
      paymentDetails: 'UPI: sunrise@bank',
    })
    expect(text).toContain('Hi Acme')
    expect(text).toContain('INV-0007 for ₹1,180.00 is now 9 days overdue (it was due on 31 May 2026)')
    expect(text).toContain('How to pay:\nUPI: sunrise@bank')
    expect(renderReminder('{customer} {unknown}', { customer: 'A', number: '', amount: '', dueDate: '', daysOverdue: 0, business: '' })).toBe('A {unknown}')
  })
})
