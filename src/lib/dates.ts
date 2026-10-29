// Dates are stored as local calendar dates in "YYYY-MM-DD" form, which sort and compare as strings.

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function today(): string {
  return toISODate(new Date())
}

export function isISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  return toISODate(fromISODate(s)) === s
}

export function addDays(iso: string, days: number): string {
  const d = fromISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

export function addMonths(iso: string, months: number): string {
  const d = fromISODate(iso)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return toISODate(d)
}

export function startOfMonth(iso: string): string {
  return iso.slice(0, 8) + '01'
}

export function endOfMonth(iso: string): string {
  const d = fromISODate(iso)
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

/** First day of the fiscal year containing `iso`, given the month (1-12) the fiscal year starts in. */
export function fiscalYearStart(iso: string, startMonth: number): string {
  const d = fromISODate(iso)
  const year = d.getMonth() + 1 >= startMonth ? d.getFullYear() : d.getFullYear() - 1
  return toISODate(new Date(year, startMonth - 1, 1))
}

export function fiscalYearEnd(iso: string, startMonth: number): string {
  return addDays(addMonths(fiscalYearStart(iso, startMonth), 12), -1)
}

export interface DateRange {
  from: string
  to: string
}

export type RangePreset = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_fy' | 'last_fy' | 'custom'

export const RANGE_PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_quarter', label: 'This quarter' },
  { id: 'last_quarter', label: 'Last quarter' },
  { id: 'this_fy', label: 'This financial year' },
  { id: 'last_fy', label: 'Last financial year' },
  { id: 'custom', label: 'Custom' },
]

export function presetRange(preset: RangePreset, fyStartMonth: number, ref = today()): DateRange {
  switch (preset) {
    case 'this_month':
      return { from: startOfMonth(ref), to: endOfMonth(ref) }
    case 'last_month': {
      const prev = addMonths(startOfMonth(ref), -1)
      return { from: prev, to: endOfMonth(prev) }
    }
    case 'this_quarter':
    case 'last_quarter': {
      // Quarters follow the fiscal year, e.g. Apr–Jun is Q1 when the year starts in April.
      const fyStart = fiscalYearStart(ref, fyStartMonth)
      const monthsIn = monthsBetween(fyStart, ref)
      let from = addMonths(fyStart, Math.floor(monthsIn / 3) * 3)
      if (preset === 'last_quarter') from = addMonths(from, -3)
      return { from, to: addDays(addMonths(from, 3), -1) }
    }
    case 'this_fy':
      return { from: fiscalYearStart(ref, fyStartMonth), to: fiscalYearEnd(ref, fyStartMonth) }
    case 'last_fy': {
      const from = addMonths(fiscalYearStart(ref, fyStartMonth), -12)
      return { from, to: addDays(addMonths(from, 12), -1) }
    }
    case 'custom':
      return { from: startOfMonth(ref), to: ref }
  }
}

function monthsBetween(fromIso: string, toIso: string): number {
  const a = fromISODate(fromIso)
  const b = fromISODate(toIso)
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>()

export function formatDate(iso: string, locale: string, style: 'short' | 'medium' = 'medium'): string {
  const key = locale + style
  let f = dateFormatters.get(key)
  if (!f) {
    f =
      style === 'medium'
        ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })
        : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
    dateFormatters.set(key, f)
  }
  return f.format(fromISODate(iso))
}

export function monthLabel(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short' }).format(fromISODate(iso))
}

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
