import type { LedgerDB } from '../db/database'
import type { Doc, Recurring, RecurringTemplate, RecurringUnit } from '../db/types'
import { addDays, addMonths, isISODate, today } from '../lib/dates'
import { newId, seededId } from '../lib/id'
import { DOC_TYPES, saveDocument } from './documents'
import { AccountingError } from './errors'

const MONTHS: Record<RecurringUnit, number> = { week: 0, month: 1, quarter: 3, year: 12 }

/** Date of the nth occurrence, counted from the start so that, e.g., the 31st becomes Feb 28 and then Mar 31. */
export function occurrenceDate(r: Pick<Recurring, 'startDate' | 'every' | 'unit'>, index: number): string {
  if (r.unit === 'week') return addDays(r.startDate, 7 * r.every * index)
  return addMonths(r.startDate, MONTHS[r.unit] * r.every * index)
}

export function describeSchedule(r: Pick<Recurring, 'every' | 'unit'>): string {
  const unit = r.unit === 'quarter' ? 'quarter' : r.unit
  return r.every === 1 ? `Every ${unit}` : `Every ${r.every} ${unit}s`
}

export interface RecurringInput {
  name?: string
  docType: Recurring['docType']
  template: RecurringTemplate
  every: number
  unit: RecurringUnit
  startDate: string
  endDate?: string
  maxCount?: number
  autoApprove: boolean
}

function validate(input: RecurringInput): void {
  if (!Number.isInteger(input.every) || input.every < 1 || input.every > 99) throw new AccountingError('Repeat every 1 to 99 weeks, months, quarters or years.')
  if (!isISODate(input.startDate)) throw new AccountingError('Choose when the schedule starts.')
  if (input.endDate && (!isISODate(input.endDate) || input.endDate < input.startDate)) throw new AccountingError("The end date can't be before the start.")
  if (input.maxCount !== undefined && (!Number.isInteger(input.maxCount) || input.maxCount < 1)) throw new AccountingError('Enter how many times it should repeat.')
  if (!input.template.lines.some((l) => l.description.trim() || l.itemId)) throw new AccountingError('Add at least one line.')
  if (input.docType !== 'expense' && !input.template.contactId) throw new AccountingError(`Choose a ${DOC_TYPES[input.docType].contactLabel.toLowerCase()}.`)
  if (input.docType === 'expense' && !input.template.paidFromAccountId) throw new AccountingError('Choose the account it is paid from.')
}

/** First occurrence on or after a date. */
function indexOnOrAfter(r: Pick<Recurring, 'startDate' | 'every' | 'unit'>, date: string): number {
  let i = 0
  while (occurrenceDate(r, i) < date && i < 10_000) i++
  return i
}

export async function saveRecurring(db: LedgerDB, companyId: string, input: RecurringInput, id?: string): Promise<Recurring> {
  validate(input)
  return db.write(async () => {
    const current = id ? await db.recurring.get(id) : undefined
    if (id && (!current || current.companyId !== companyId)) throw new AccountingError('Schedule not found.', 'not_found')
    const contact = input.template.contactId ? await db.contacts.get(input.template.contactId) : undefined
    const at = Date.now()
    const timing = { startDate: input.startDate, every: input.every, unit: input.unit }
    // Changing when it repeats starts counting again from the new pattern, after anything already created.
    const timingChanged = current && (current.startDate !== input.startDate || current.every !== input.every || current.unit !== input.unit)
    const nextIndex = !current ? 0 : timingChanged ? indexOnOrAfter(timing, current.lastDate ? addDays(current.lastDate, 1) : input.startDate) : current.nextIndex
    const schedule: Recurring = {
      id: current?.id ?? newId(),
      companyId,
      name: input.name?.trim() || `${contact?.name ?? DOC_TYPES[input.docType].label} · ${describeSchedule(input).toLowerCase()}`,
      docType: input.docType,
      template: { ...input.template, lines: input.template.lines.filter((l) => l.description.trim() || l.itemId) },
      ...timing,
      nextIndex,
      endDate: input.endDate || undefined,
      maxCount: input.maxCount,
      autoApprove: input.autoApprove,
      status: current?.status === 'paused' ? 'paused' : 'active',
      createdCount: current?.createdCount ?? 0,
      lastDate: current?.lastDate,
      createdAt: current?.createdAt ?? at,
      updatedAt: at,
    }
    if (isFinished(schedule)) schedule.status = 'ended'
    await db.recurring.put(schedule)
    await db.track(companyId, 'recurring', schedule.id)
    await db.logAudit(companyId, current ? 'update' : 'create', 'recurring', schedule.id, `${current ? 'Updated' : 'Created'} recurring ${DOC_TYPES[input.docType].label.toLowerCase()} "${schedule.name}"`)
    return schedule
  })
}

function isFinished(r: Recurring): boolean {
  if (r.maxCount !== undefined && r.createdCount >= r.maxCount) return true
  return !!r.endDate && occurrenceDate(r, r.nextIndex) > r.endDate
}

export async function setRecurringPaused(db: LedgerDB, id: string, paused: boolean): Promise<void> {
  await db.write(async () => {
    const r = await db.recurring.get(id)
    if (!r) throw new AccountingError('Schedule not found.', 'not_found')
    if (r.status === 'ended') throw new AccountingError('This schedule has ended. Edit its end to restart it.')
    // Resuming carries on from today; dates missed while paused are skipped, not created in a rush.
    const nextIndex = paused ? r.nextIndex : Math.max(r.nextIndex, indexOnOrAfter(r, today()))
    await db.recurring.update(id, { status: paused ? 'paused' : 'active', nextIndex, updatedAt: Date.now() })
    await db.track(r.companyId, 'recurring', id, { fields: ['status', 'nextIndex', 'updatedAt'] })
  })
}

export async function deleteRecurring(db: LedgerDB, id: string): Promise<void> {
  await db.write(async () => {
    const r = await db.recurring.get(id)
    if (!r) return
    await db.recurring.delete(id)
    await db.track(r.companyId, 'recurring', id, { op: 'delete' })
    await db.logAudit(r.companyId, 'delete', 'recurring', id, `Deleted recurring schedule "${r.name}"`)
  })
}

const PROGRESS = ['nextIndex', 'createdCount', 'lastDate', 'status', 'updatedAt']

async function saveProgress(db: LedgerDB, r: Recurring): Promise<void> {
  await db.recurring.put({ ...r, updatedAt: Date.now() })
  await db.track(r.companyId, 'recurring', r.id, { fields: PROGRESS })
}

/**
 * Creates the document for occurrence `index`, dated `date`, and moves the schedule on, in one go.
 * Returns the schedule as it now is, and the document (null if this occurrence already existed).
 */
async function createOccurrence(db: LedgerDB, scheduleId: string, index: number, date: string): Promise<{ r: Recurring; doc: Doc | null } | null> {
  const attempt = (post: boolean) =>
    db.write(async () => {
      const r = await db.recurring.get(scheduleId)
      // Another tab or device got here first.
      if (!r || r.status === 'ended' || r.nextIndex !== index) return null
      const seed = `recurring/${r.id}/${index}`
      let doc: Doc | null = null
      if (!(await db.documents.get(seededId(seed)))) {
        const t = r.template
        const input = {
          type: r.docType,
          contactId: t.contactId,
          date,
          dueDate: r.docType === 'expense' ? undefined : addDays(date, t.dueInDays),
          reference: t.reference,
          lines: t.lines.map((l, i) => ({ ...l, id: seededId(`${seed}/docline/${i}`) })),
          taxInclusive: t.taxInclusive,
          notes: t.notes,
          terms: t.terms,
          paidFromAccountId: t.paidFromAccountId,
        }
        doc = await saveDocument(db, r.companyId, input, { idSeed: seed, recurringId: r.id, post })
      }
      const next: Recurring = { ...r, nextIndex: index + 1, createdCount: r.createdCount + 1, lastDate: date }
      if (isFinished(next)) next.status = 'ended'
      await saveProgress(db, next)
      return { r: next, doc }
    })
  const r = await db.recurring.get(scheduleId)
  if (!r?.autoApprove) return attempt(false)
  try {
    return await attempt(true)
  } catch (err) {
    // If it can't be approved (e.g. a locked period or an archived account), keep it as a draft to fix.
    if (!(err instanceof AccountingError)) throw err
    return attempt(false)
  }
}

/**
 * Creates every document that's due up to `asOf`, including ones missed while the app was closed
 * (at most `limit` per schedule per run). Safe to run repeatedly and on several devices.
 */
export async function runRecurring(db: LedgerDB, companyId: string, asOf = today(), limit = 24): Promise<Doc[]> {
  const created: Doc[] = []
  const schedules = (await db.recurring.where('companyId').equals(companyId).toArray()).filter((r) => r.status === 'active')
  for (let r of schedules) {
    for (let made = 0; r.status === 'active' && made < limit; made++) {
      const date = occurrenceDate(r, r.nextIndex)
      if (date > asOf) break
      if (isFinished(r)) {
        await db.write(() => saveProgress(db, { ...r, status: 'ended' }))
        break
      }
      const result = await createOccurrence(db, r.id, r.nextIndex, date)
      if (!result) break
      if (result.doc) created.push(result.doc)
      r = result.r
    }
  }
  return created
}

/** Creates the next document now, dated today, instead of waiting for its date. */
export async function createNextNow(db: LedgerDB, id: string): Promise<Doc | null> {
  const r = await db.recurring.get(id)
  if (!r) throw new AccountingError('Schedule not found.', 'not_found')
  if (r.status === 'ended') throw new AccountingError('This schedule has ended.')
  return (await createOccurrence(db, id, r.nextIndex, today()))?.doc ?? null
}

/** When the next document will be created, or undefined if the schedule won't create more. */
export function nextDate(r: Recurring): string | undefined {
  if (r.status === 'ended' || isFinished(r)) return undefined
  return occurrenceDate(r, r.nextIndex)
}
