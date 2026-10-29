import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { computeProfitLoss, type ProfitLoss, type ReportSection } from '../../accounting/reports'
import { DateRangeControl, useDateRange } from '../../components/DateRange'
import { Switch } from '../../components/ui/form'
import { Spinner } from '../../components/ui/misc'
import { cn } from '../../lib/cn'
import { addDays, fromISODate } from '../../lib/dates'
import { useCompany, useFormat } from '../../state/company'
import { useAccounts, useLines } from '../../state/data'
import { usePrefs } from '../../state/prefs'
import { ReportPage, sectionCsv } from './shared'

type SectionKey = 'income' | 'costOfSales' | 'expenses' | 'otherIncome' | 'otherExpenses'

export function ProfitLossReport() {
  const company = useCompany()
  const f = useFormat()
  const { mode } = usePrefs()
  const [range, setRange] = useDateRange('this_fy')
  const [compare, setCompare] = useState(false)
  const days = Math.round((fromISODate(range.to).getTime() - fromISODate(range.from).getTime()) / 86_400_000)
  const prevTo = addDays(range.from, -1)
  const prevFrom = addDays(prevTo, -days)
  const accounts = useAccounts(company.id)
  const lines = useLines(company.id, range.from, range.to)
  const prevLines = useLines(company.id, prevFrom, prevTo)
  const pl = useMemo(() => (accounts && lines ? computeProfitLoss(accounts, lines) : null), [accounts, lines])
  const prev = useMemo(() => (accounts && prevLines ? computeProfitLoss(accounts, prevLines) : null), [accounts, prevLines])

  if (!pl || !prev) return <Spinner />
  const linkQuery = `preset=custom&from=${range.from}&to=${range.to}`
  const period = `${f.date(range.from)} – ${f.date(range.to)}`
  const margin = pl.income.total ? Math.round((pl.netProfit / pl.income.total) * 1000) / 10 : null
  const other = compare ? prev : undefined
  const showCos = pl.costOfSales.rows.length > 0 || (compare && prev.costOfSales.rows.length > 0)
  const showOther = pl.otherIncome.rows.length + pl.otherExpenses.rows.length + (compare ? prev.otherIncome.rows.length + prev.otherExpenses.rows.length : 0) > 0

  return (
    <ReportPage
      title="Profit & loss"
      description="Did the business make money? Income minus expenses for the period."
      period={compare ? `${period}, compared with ${f.date(prevFrom)} – ${f.date(prevTo)}` : period}
      controls={
        <div className="flex flex-wrap items-center gap-4">
          <DateRangeControl range={range} onChange={setRange} />
          <Switch checked={compare} onChange={setCompare} label="Compare with previous period" />
        </div>
      }
      csv={() => [
        ['Profit & loss', period],
        ['', ''],
        ...sectionCsv(pl.income, f.toInput),
        ...sectionCsv(pl.costOfSales, f.toInput),
        ['Gross profit', f.toInput(pl.grossProfit) || '0'],
        ...sectionCsv(pl.expenses, f.toInput),
        ['Operating profit', f.toInput(pl.operatingProfit) || '0'],
        ...sectionCsv(pl.otherIncome, f.toInput),
        ...sectionCsv(pl.otherExpenses, f.toInput),
        ['Net profit', f.toInput(pl.netProfit) || '0'],
      ]}
    >
      {compare && (
        <div className="mx-3 grid grid-cols-[minmax(0,1fr)_8rem_8rem_5rem] gap-3 border-b border-line pb-2 text-right text-xs text-fg-subtle max-sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem]">
          <span />
          <span>This period</span>
          <span>Previous</span>
          <span className="max-sm:hidden">Change</span>
        </div>
      )}
      <Section k="income" pl={pl} prev={other} linkQuery={linkQuery} showCode={mode === 'accountant'} />
      {showCos && (
        <>
          <Section k="costOfSales" pl={pl} prev={other} linkQuery={linkQuery} showCode={mode === 'accountant'} />
          <Total label="Gross profit" value={pl.grossProfit} prev={other?.grossProfit} />
        </>
      )}
      <Section k="expenses" pl={pl} prev={other} linkQuery={linkQuery} showCode={mode === 'accountant'} />
      {showOther && (
        <>
          <Total label="Operating profit" value={pl.operatingProfit} prev={other?.operatingProfit} />
          <Section k="otherIncome" pl={pl} prev={other} linkQuery={linkQuery} showCode={mode === 'accountant'} />
          <Section k="otherExpenses" pl={pl} prev={other} linkQuery={linkQuery} showCode={mode === 'accountant'} />
        </>
      )}
      <Total label={pl.netProfit >= 0 ? 'Net profit' : 'Net loss'} value={pl.netProfit} prev={other?.netProfit} strong />
      {margin !== null && <p className="px-3 pt-1 pb-2 text-right text-xs text-fg-subtle">Net margin {margin}%</p>}
    </ReportPage>
  )
}

function Section({ k, pl, prev, linkQuery, showCode }: { k: SectionKey; pl: ProfitLoss; prev?: ProfitLoss; linkQuery: string; showCode: boolean }) {
  const f = useFormat()
  const now = pl[k] as ReportSection
  const before = prev?.[k] as ReportSection | undefined
  if (!now.rows.length && !before?.rows.length && (k === 'otherIncome' || k === 'otherExpenses')) return null
  const ids = [...new Set([...now.rows.map((r) => r.id), ...(before?.rows.map((r) => r.id) ?? [])])]
  const find = (s: ReportSection | undefined, id: string) => s?.rows.find((r) => r.id === id)
  const rows = ids.map((id) => ({ id, row: find(now, id) ?? find(before, id)!, amount: find(now, id)?.amount ?? 0, prev: find(before, id)?.amount ?? 0 })).sort((a, b) => (a.row.code ?? '').localeCompare(b.row.code ?? ''))

  return (
    <div className="mb-2">
      <h3 className="px-3 pt-3 pb-1.5 text-xs font-semibold tracking-wider text-fg-subtle uppercase">{now.title}</h3>
      {rows.length === 0 && <p className="px-3 py-1.5 text-sm text-fg-subtle">Nothing in this period</p>}
      {rows.map((r) => (
        <Link
          key={r.id}
          to={`/accounts/${r.id}?${linkQuery}`}
          className={cn('grid items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-surface-2', prev ? 'grid-cols-[minmax(0,1fr)_8rem_8rem_5rem] max-sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem]' : 'grid-cols-[minmax(0,1fr)_auto]')}
        >
          <span className="truncate">
            {showCode && r.row.code && <span className="mr-2 text-xs text-fg-subtle tabular-nums">{r.row.code}</span>}
            {r.row.label}
          </span>
          <span className={cn('text-right tabular-nums', r.amount < 0 && 'text-danger')}>{f.money(r.amount)}</span>
          {prev && <span className="text-right text-fg-muted tabular-nums">{f.money(r.prev)}</span>}
          {prev && <Change now={r.amount} before={r.prev} />}
        </Link>
      ))}
      <Total label={`Total ${now.title.toLowerCase()}`} value={now.total} prev={before?.total} />
    </div>
  )
}

function Change({ now, before }: { now: number; before: number }) {
  if (!before) return <span className="text-right text-xs text-fg-subtle max-sm:hidden">{now ? 'New' : ''}</span>
  const pct = Math.round(((now - before) / Math.abs(before)) * 100)
  return <span className={cn('text-right text-xs tabular-nums max-sm:hidden', pct > 0 ? 'text-success' : pct < 0 ? 'text-danger' : 'text-fg-subtle')}>{pct > 0 ? '+' : ''}{pct}%</span>
}

function Total({ label, value, prev, strong }: { label: string; value: number; prev?: number; strong?: boolean }) {
  const f = useFormat()
  return (
    <div
      className={cn(
        'mx-3 grid items-center gap-3 border-t py-2.5 text-sm font-semibold',
        prev !== undefined ? 'grid-cols-[minmax(0,1fr)_8rem_8rem_5rem] max-sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem]' : 'grid-cols-[minmax(0,1fr)_auto]',
        strong ? 'mt-3 border-t-2 border-fg/70 text-base' : 'border-line',
      )}
    >
      <span>{label}</span>
      <span className={cn('text-right tabular-nums', value < 0 && 'text-danger')}>{f.money(value)}</span>
      {prev !== undefined && <span className="text-right text-fg-muted tabular-nums">{f.money(prev)}</span>}
      {prev !== undefined && <Change now={value} before={prev} />}
    </div>
  )
}
