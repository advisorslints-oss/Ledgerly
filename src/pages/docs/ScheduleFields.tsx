import { occurrenceDate } from '../../accounting/recurring'
import { Field, Input, Select, Switch } from '../../components/ui/form'
import { Card } from '../../components/ui/misc'
import type { Recurring, RecurringUnit } from '../../db/types'
import { addDays, today } from '../../lib/dates'
import { useFormat } from '../../state/company'

export interface Plan {
  name: string
  every: number
  unit: RecurringUnit
  startDate: string
  ends: 'never' | 'date' | 'count'
  endDate: string
  maxCount: number
  autoApprove: boolean
}

export function newPlan(startDate = today()): Plan {
  return { name: '', every: 1, unit: 'month', startDate, ends: 'never', endDate: '', maxCount: 12, autoApprove: true }
}

export function planFrom(r: Recurring): Plan {
  return {
    name: r.name,
    every: r.every,
    unit: r.unit,
    startDate: r.startDate,
    ends: r.endDate ? 'date' : r.maxCount !== undefined ? 'count' : 'never',
    endDate: r.endDate ?? '',
    maxCount: r.maxCount ?? 12,
    autoApprove: r.autoApprove,
  }
}

export function planInput(p: Plan) {
  return {
    name: p.name,
    every: p.every,
    unit: p.unit,
    startDate: p.startDate,
    endDate: p.ends === 'date' ? p.endDate : undefined,
    maxCount: p.ends === 'count' ? p.maxCount : undefined,
    autoApprove: p.autoApprove,
  }
}

const UNITS: { value: RecurringUnit; one: string; many: string }[] = [
  { value: 'week', one: 'week', many: 'weeks' },
  { value: 'month', one: 'month', many: 'months' },
  { value: 'quarter', one: 'quarter', many: 'quarters' },
  { value: 'year', one: 'year', many: 'years' },
]

export interface Progress {
  count: number
  lastDate?: string
  /** The saved schedule, if editing: while its timing is unchanged it carries on from where it is. */
  saved?: Pick<Recurring, 'startDate' | 'every' | 'unit' | 'nextIndex'>
}

/** The dates a plan would create from now on: how many are already past (created straight away) and the next few. */
function preview(p: Plan, done: Progress) {
  const s = done.saved
  const same = !!s && s.startDate === p.startDate && s.every === p.every && s.unit === p.unit
  const from = done.lastDate ? addDays(done.lastDate, 1) : p.startDate
  const now = today()
  let past = 0
  const upcoming: string[] = []
  for (let i = same && s ? s.nextIndex : 0, made = done.count; i < 2000 && upcoming.length < 3; i++) {
    const date = occurrenceDate(p, i)
    if (!same && date < from) continue
    if (p.ends === 'date' && p.endDate && date > p.endDate) break
    if (p.ends === 'count' && made >= p.maxCount) break
    made++
    if (date <= now) past++
    else upcoming.push(date)
  }
  return { past, upcoming }
}

export function ScheduleFields({ plan, onChange, label, done }: { plan: Plan; onChange: (p: Plan) => void; label: string; done: Progress }) {
  const f = useFormat()
  const set = <K extends keyof Plan>(k: K, v: Plan[K]) => onChange({ ...plan, [k]: v })
  const { past, upcoming } = preview(plan, done)
  const lower = label.toLowerCase()

  return (
    <Card className="mb-4 p-5">
      <h2 className="mb-4 text-[15px] font-semibold">Schedule</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Repeat every">
          {(fid) => (
            <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
              <Input id={fid} inputMode="numeric" value={plan.every || ''} onChange={(e) => set('every', Math.min(99, Math.max(0, Math.floor(Number(e.target.value) || 0))))} className="text-right tabular-nums" aria-label="How many" />
              <Select value={plan.unit} onChange={(e) => set('unit', e.target.value as RecurringUnit)} aria-label="Unit">
                {UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {plan.every === 1 ? u.one : u.many}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </Field>
        <Field label={done.count ? 'Counting from' : `First ${lower} on`}>{(fid) => <Input id={fid} type="date" required value={plan.startDate} onChange={(e) => set('startDate', e.target.value)} />}</Field>
        <Field label="Ends">
          {(fid) => (
            <Select id={fid} value={plan.ends} onChange={(e) => set('ends', e.target.value as Plan['ends'])}>
              <option value="never">Never</option>
              <option value="date">On a date</option>
              <option value="count">After a number of times</option>
            </Select>
          )}
        </Field>
        {plan.ends === 'date' && <Field label="Last date">{(fid) => <Input id={fid} type="date" value={plan.endDate} min={plan.startDate} onChange={(e) => set('endDate', e.target.value)} required />}</Field>}
        {plan.ends === 'count' && (
          <Field label="Times in total" hint={done.count ? `${done.count} created so far` : undefined}>
            {(fid, d) => <Input id={fid} aria-describedby={d} inputMode="numeric" value={plan.maxCount || ''} onChange={(e) => set('maxCount', Math.max(0, Math.floor(Number(e.target.value) || 0)))} className="tabular-nums" />}
          </Field>
        )}
        <Field label="Name" className="sm:col-span-2" hint="Optional. Shown in your list of recurring documents.">
          {(fid, d) => <Input id={fid} aria-describedby={d} value={plan.name} onChange={(e) => set('name', e.target.value)} maxLength={80} placeholder="e.g. Monthly retainer" />}
        </Field>
        <div className="sm:col-span-2 lg:pt-6">
          <Switch
            checked={plan.autoApprove}
            onChange={(v) => set('autoApprove', v)}
            label="Approve automatically"
            description={plan.autoApprove ? `Each ${lower} goes straight into your books.` : `Each ${lower} is saved as a draft for you to check and approve.`}
          />
        </div>
      </div>
      <p className="mt-4 rounded-xl bg-surface-2/70 px-4 py-3 text-sm text-fg-muted">
        {past > 0 && (
          <span className="font-medium text-fg">{past === 1 ? 'One will be created as soon as you save. ' : `${past}, for dates up to today, will be created as soon as you save. `}</span>
        )}
        {upcoming.length ? `Coming up: ${upcoming.map((d) => f.date(d)).join(', ')}${upcoming.length === 3 ? '…' : ''}` : past ? '' : `No more ${lower}s will be created with these settings.`}
      </p>
    </Card>
  )
}
