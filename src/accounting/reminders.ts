import type { LedgerDB } from '../db/database'
import type { Company, Doc, Reminder, ReminderSettings, ReminderStage } from '../db/types'
import { fromISODate, today } from '../lib/dates'
import { newId } from '../lib/id'

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: true,
  stages: [
    { days: -3, tone: 'gentle' },
    { days: 1, tone: 'gentle' },
    { days: 7, tone: 'firm' },
    { days: 21, tone: 'final' },
  ],
  templates: {
    gentle: 'Hi {customer},\n\nA friendly reminder that invoice {number} for {amount} {due_text}.\n\n{payment_details}\n\nThank you,\n{business}',
    firm: "Hi {customer},\n\nInvoice {number} for {amount} is now {days_overdue} days overdue (it was due on {due_date}). Please arrange payment soon, or let us know if there's a problem with it.\n\n{payment_details}\n\nThanks,\n{business}",
    final: 'Hi {customer},\n\nInvoice {number} for {amount} is {days_overdue} days overdue. Please pay it within 7 days, or contact us so we can sort it out together.\n\n{payment_details}\n\nRegards,\n{business}',
  },
}

/** Stages people can switch on, in order. */
export const STAGE_CHOICES: ReminderStage[] = [
  { days: -7, tone: 'gentle' },
  { days: -3, tone: 'gentle' },
  { days: 0, tone: 'gentle' },
  { days: 1, tone: 'gentle' },
  { days: 7, tone: 'firm' },
  { days: 14, tone: 'firm' },
  { days: 21, tone: 'final' },
  { days: 30, tone: 'final' },
]

export function reminderSettings(company: Pick<Company, 'documentSettings'>): ReminderSettings {
  const saved = company.documentSettings?.reminders
  return saved ? { ...DEFAULT_REMINDERS, ...saved, templates: { ...DEFAULT_REMINDERS.templates, ...saved.templates } } : DEFAULT_REMINDERS
}

export function stageLabel(days: number): string {
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} before due`
  if (days === 0) return 'On the due date'
  if (days % 7 === 0) return `${days / 7} week${days === 7 ? '' : 's'} overdue`
  return `${days} day${days === 1 ? '' : 's'} overdue`
}

export const daysOverdue = (dueDate: string, asOf = today()) => Math.round((fromISODate(asOf).getTime() - fromISODate(dueDate).getTime()) / 86_400_000)

/** The latest stage an invoice this many days overdue has reached (index into the stages sorted by day), or -1. */
export function reachedStage(settings: ReminderSettings, days: number): { index: number; stage: ReminderStage } {
  const stages = [...settings.stages].sort((a, b) => a.days - b.days)
  let index = -1
  stages.forEach((s, i) => days >= s.days && (index = i))
  return { index, stage: stages[index] ?? { days, tone: days > 14 ? 'final' : days > 3 ? 'firm' : 'gentle' } }
}

export interface DueReminder {
  doc: Doc
  due: number
  stageIndex: number
  stage: ReminderStage
  /** Positive when overdue, negative before the due date. */
  daysOverdue: number
  last?: Reminder
}

/**
 * Invoices that have reached a reminder stage they haven't been reminded for yet. Only the latest
 * stage counts: an invoice that's three weeks late gets the final reminder, not every earlier one.
 */
export function dueReminders(docs: Doc[], settled: Map<string, number>, reminders: Reminder[], settings: ReminderSettings, asOf = today()): DueReminder[] {
  if (!settings.enabled || !settings.stages.length) return []
  const byDoc = new Map<string, Reminder[]>()
  for (const r of reminders) byDoc.set(r.documentId, [...(byDoc.get(r.documentId) ?? []), r])
  const out: DueReminder[] = []
  for (const doc of docs) {
    if (doc.type !== 'invoice' || doc.status !== 'posted' || !doc.dueDate) continue
    const due = doc.total - (settled.get(doc.id) ?? 0)
    if (due <= 0) continue
    const days = daysOverdue(doc.dueDate, asOf)
    const { index, stage } = reachedStage(settings, days)
    if (index < 0) continue
    const sent = (byDoc.get(doc.id) ?? []).sort((a, b) => b.sentAt - a.sentAt)
    const highest = sent.reduce((m, r) => Math.max(m, r.stage), -1)
    if (highest >= index) continue
    out.push({ doc, due, stageIndex: index, stage, daysOverdue: days, last: sent[0] })
  }
  return out.sort((a, b) => b.daysOverdue - a.daysOverdue)
}

export interface ReminderVars {
  customer: string
  number: string
  amount: string
  dueDate: string
  daysOverdue: number
  business: string
  paymentDetails?: string
}

/** Fills a template's {placeholders}. Unknown placeholders are left as typed. */
export function renderReminder(template: string, v: ReminderVars): string {
  const dueText = v.daysOverdue > 0 ? `was due on ${v.dueDate}` : v.daysOverdue === 0 ? 'is due today' : `is due on ${v.dueDate}`
  const values: Record<string, string> = {
    customer: v.customer,
    number: v.number,
    amount: v.amount,
    due_date: v.dueDate,
    due_text: dueText,
    days_overdue: String(Math.max(0, v.daysOverdue)),
    business: v.business,
    payment_details: v.paymentDetails ? `How to pay:\n${v.paymentDetails}` : '',
  }
  return template
    .replace(/\{(\w+)\}/g, (m, key: string) => values[key] ?? m)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function logReminder(db: LedgerDB, doc: Doc, stage: number, channel: Reminder['channel']): Promise<Reminder> {
  return db.write(async () => {
    const reminder: Reminder = { id: newId(), companyId: doc.companyId, documentId: doc.id, contactId: doc.contactId, stage, channel, sentAt: Date.now() }
    await db.reminders.add(reminder)
    await db.track(doc.companyId, 'reminders', reminder.id)
    await db.logAudit(doc.companyId, 'remind', 'document', doc.id, `Sent a payment reminder for ${doc.number} (${channel === 'manual' ? 'marked as sent' : `by ${channel}`})`)
    return reminder
  })
}

export async function undoReminder(db: LedgerDB, id: string): Promise<void> {
  await db.write(async () => {
    const r = await db.reminders.get(id)
    if (!r) return
    await db.reminders.delete(id)
    await db.track(r.companyId, 'reminders', id, { op: 'delete' })
  })
}
