import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AGING_BUCKETS, agingReport, byContact, byItem, cashFlow, generalLedger, taxSummary, type CashCategory } from '../../accounting/insights'
import { stockLevels } from '../../accounting/items'
import { MIN_DATE } from '../../accounting/reports'
import { DateRangeControl, useDateRange } from '../../components/DateRange'
import { Input } from '../../components/ui/form'
import { Spinner } from '../../components/ui/misc'
import { db } from '../../db'
import type { JournalEntry } from '../../db/types'
import { cn } from '../../lib/cn'
import { addDays, today } from '../../lib/dates'
import { useCompany, useFormat } from '../../state/company'
import { useAccounts, useContacts, useItems, useLedgerDocs, useLines, useStockMoves, useTaxRates } from '../../state/data'
import { usePrefs } from '../../state/prefs'
import { ReportPage, TotalRow } from './shared'

const th = 'px-3 py-2 font-medium'
const td = 'px-3 py-2'

function useAsOf(): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams()
  return [params.get('to') || today(), (to: string) => setParams({ to }, { replace: true })]
}

const CASH_LABELS: Record<CashCategory, { title: string; help: string }> = {
  operating: { title: 'Day-to-day operations', help: 'Customers, suppliers, staff, rent and other running costs.' },
  investing: { title: 'Investments in assets', help: 'Buying or selling equipment, vehicles and property.' },
  financing: { title: 'Financing', help: 'Loans, owner money in and drawings out.' },
}

export function CashFlowReport() {
  const company = useCompany()
  const f = useFormat()
  const [range, setRange] = useDateRange('this_fy')
  const accounts = useAccounts(company.id)
  const within = useLines(company.id, range.from, range.to)
  const before = useLines(company.id, undefined, addDays(range.from, -1))
  const cf = useMemo(() => (accounts && within && before ? cashFlow(accounts, within, before) : null), [accounts, within, before])
  if (!cf) return <Spinner />
  const period = `${f.date(range.from)} – ${f.date(range.to)}`
  const query = `preset=custom&from=${range.from}&to=${range.to}`

  return (
    <ReportPage
      title="Cash flow"
      description="Where your cash came from and where it went."
      period={period}
      controls={<DateRangeControl range={range} onChange={setRange} />}
      csv={() => [
        ['Cash flow', period],
        ['Opening cash', f.toInput(cf.opening) || '0'],
        ...(['operating', 'investing', 'financing'] as const).flatMap((k) => [
          [CASH_LABELS[k].title, ''],
          ...cf.sections[k].rows.map((r) => [r.account.name, f.toInput(r.amount) || '0']),
          [`Net ${k}`, f.toInput(cf.sections[k].total) || '0'],
        ]),
        ['Net change in cash', f.toInput(cf.net) || '0'],
        ['Closing cash', f.toInput(cf.closing) || '0'],
      ]}
    >
      <div className="mx-3 flex items-center justify-between border-b border-line py-2.5 text-sm">
        <span className="text-fg-muted">Cash and bank at the start</span>
        <span className="tabular-nums">{f.money(cf.opening)}</span>
      </div>
      {(['operating', 'investing', 'financing'] as const).map((k) => (
        <div key={k} className="mt-2">
          <h3 className="px-3 pt-3 text-xs font-semibold tracking-wider text-fg-subtle uppercase">{CASH_LABELS[k].title}</h3>
          <p className="px-3 pb-1.5 text-xs text-fg-subtle">{CASH_LABELS[k].help}</p>
          {cf.sections[k].rows.map((r) => (
            <Link key={r.account.id} to={`/accounts/${r.account.id}?${query}`} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-surface-2">
              <span className="flex-1">{r.amount > 0 ? 'From' : 'For'} {r.account.name}</span>
              <span className={cn('tabular-nums', r.amount < 0 && 'text-fg-muted')}>{f.money(r.amount)}</span>
            </Link>
          ))}
          {cf.sections[k].rows.length === 0 && <p className="px-3 py-1.5 text-sm text-fg-subtle">No cash movement</p>}
          <TotalRow label={`Net cash from ${CASH_LABELS[k].title.toLowerCase()}`} amount={cf.sections[k].total} />
        </div>
      ))}
      <TotalRow label="Net change in cash" amount={cf.net} />
      <TotalRow label="Cash and bank at the end" amount={cf.closing} strong />
    </ReportPage>
  )
}

export function AgedReport({ type }: { type: 'invoice' | 'bill' }) {
  const company = useCompany()
  const f = useFormat()
  const [asOf, setAsOf] = useAsOf()
  const { docs, settled } = useLedgerDocs(company.id)
  const contacts = useContacts(company.id)
  const report = useMemo(() => (docs && settled && contacts ? agingReport(docs, settled, type, asOf, new Map(contacts.map((c) => [c.id, c]))) : null), [docs, settled, contacts, type, asOf])
  if (!report) return <Spinner />
  const title = type === 'invoice' ? 'Aged receivables' : 'Aged payables'
  const heads = ['Not yet due', '1–30 days', '31–60 days', '61–90 days', 'Over 90 days']
  const base = type === 'invoice' ? '/sales/customers' : '/purchases/suppliers'

  return (
    <ReportPage
      title={title}
      description={type === 'invoice' ? 'Who owes you money, and how late it is.' : 'What you owe suppliers, and how late it is.'}
      period={`As of ${f.date(asOf)}`}
      controls={<Input type="date" aria-label="As of" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="w-auto" />}
      csv={() => [['Contact', ...heads, 'Total'], ...[...report.rows, report.totals].map((r) => [r.name, ...AGING_BUCKETS.map((b) => f.toInput(r[b]) || '0'), f.toInput(r.total) || '0'])]}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-fg-subtle">
              <th className={th}>{type === 'invoice' ? 'Customer' : 'Supplier'}</th>
              {heads.map((h) => (
                <th key={h} className={cn(th, 'text-right')}>
                  {h}
                </th>
              ))}
              <th className={cn(th, 'text-right')}>Total</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {report.rows.map((r) => (
              <tr key={r.id} className="border-b border-line hover:bg-surface-2/50">
                <td className={td}>
                  {r.id === 'none' ? r.name : <Link to={`${base}/${r.id}`} className="hover:text-primary-ink">{r.name}</Link>}
                </td>
                {AGING_BUCKETS.map((b) => (
                  <td key={b} className={cn(td, 'text-right', b !== 'current' && r[b] > 0 && 'text-danger')}>
                    {r[b] ? f.money(r[b]) : ''}
                  </td>
                ))}
                <td className={cn(td, 'text-right font-semibold')}>{f.money(r.total)}</td>
              </tr>
            ))}
            {report.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-fg-subtle">
                  Nothing outstanding.
                </td>
              </tr>
            )}
            <tr className="border-t-2 border-fg/70 font-semibold">
              <td className={td}>Total</td>
              {AGING_BUCKETS.map((b) => (
                <td key={b} className={cn(td, 'text-right')}>
                  {f.money(report.totals[b])}
                </td>
              ))}
              <td className={cn(td, 'text-right')}>{f.money(report.totals.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </ReportPage>
  )
}

export function ByContactReport({ side }: { side: 'sales' | 'purchases' }) {
  const company = useCompany()
  const f = useFormat()
  const [range, setRange] = useDateRange('this_fy')
  const { docs } = useLedgerDocs(company.id)
  const contacts = useContacts(company.id)
  const rows = useMemo(() => (docs && contacts ? byContact(docs, range.from, range.to, side, new Map(contacts.map((c) => [c.id, c]))) : null), [docs, contacts, range.from, range.to, side])
  if (!rows) return <Spinner />
  const title = side === 'sales' ? 'Sales by customer' : 'Purchases by supplier'
  const period = `${f.date(range.from)} – ${f.date(range.to)}`
  const total = rows.reduce((s, r) => ({ net: s.net + r.net, tax: s.tax + r.tax, total: s.total + r.total }), { net: 0, tax: 0, total: 0 })
  const base = side === 'sales' ? '/sales/customers' : '/purchases/suppliers'

  return (
    <ReportPage
      title={title}
      description={side === 'sales' ? 'Your best customers, before and after tax. Credit notes are subtracted.' : 'Who you buy from the most. Supplier credits are subtracted.'}
      period={period}
      controls={<DateRangeControl range={range} onChange={setRange} />}
      csv={() => [[side === 'sales' ? 'Customer' : 'Supplier', 'Documents', 'Before tax', 'Tax', 'Total'], ...rows.map((r) => [r.name, r.count, f.toInput(r.net) || '0', f.toInput(r.tax) || '0', f.toInput(r.total) || '0'])]}
    >
      <SimpleTable
        head={[side === 'sales' ? 'Customer' : 'Supplier', 'Documents', 'Before tax', 'Tax', 'Total']}
        rows={rows.map((r) => ({
          key: r.id,
          cells: [r.id === 'none' ? r.name : <Link to={`${base}/${r.id}`} className="hover:text-primary-ink">{r.name}</Link>, r.count, f.money(r.net), f.money(r.tax), f.money(r.total)],
        }))}
        foot={['Total', '', f.money(total.net), f.money(total.tax), f.money(total.total)]}
      />
    </ReportPage>
  )
}

export function ByItemReport({ side }: { side: 'sales' | 'purchases' }) {
  const company = useCompany()
  const f = useFormat()
  const [range, setRange] = useDateRange('this_fy')
  const { docs } = useLedgerDocs(company.id)
  const items = useItems(company.id)
  const taxRates = useTaxRates(company.id)
  const rows = useMemo(
    () => (docs && items && taxRates ? byItem(docs, range.from, range.to, side, new Map(items.map((i) => [i.id, i])), new Map(taxRates.map((t) => [t.id, t]))) : null),
    [docs, items, taxRates, range.from, range.to, side],
  )
  if (!rows) return <Spinner />
  const period = `${f.date(range.from)} – ${f.date(range.to)}`
  const total = rows.reduce((s, r) => s + r.net, 0)
  return (
    <ReportPage
      title={side === 'sales' ? 'Sales by item' : 'Purchases by item'}
      description="Quantities and amounts before tax, for each product or service."
      period={period}
      controls={<DateRangeControl range={range} onChange={setRange} />}
      csv={() => [['Item', 'Quantity', 'Amount before tax'], ...rows.map((r) => [r.name, r.quantity, f.toInput(r.net) || '0'])]}
    >
      <SimpleTable
        head={['Item', 'Quantity', 'Amount before tax', 'Share']}
        rows={rows.map((r) => ({
          key: r.id,
          cells: [r.id === 'none' ? r.name : <Link to={`/items/${r.id}`} className="hover:text-primary-ink">{r.name}</Link>, Math.round(r.quantity * 100) / 100, f.money(r.net), total ? `${Math.round((r.net / total) * 1000) / 10}%` : ''],
        }))}
        foot={['Total', '', f.money(total), '']}
      />
    </ReportPage>
  )
}

export function TaxSummaryReport() {
  const company = useCompany()
  const f = useFormat()
  const [range, setRange] = useDateRange('this_quarter')
  const accounts = useAccounts(company.id)
  const lines = useLines(company.id, range.from, range.to)
  const t = useMemo(() => (accounts && lines ? taxSummary(accounts, lines) : null), [accounts, lines])
  if (!t) return <Spinner />
  const period = `${f.date(range.from)} – ${f.date(range.to)}`
  const query = `preset=custom&from=${range.from}&to=${range.to}`
  const section = (title: string, rows: typeof t.collected, totalLabel: string, total: number) => (
    <div className="mb-2">
      <h3 className="px-3 pt-3 pb-1.5 text-xs font-semibold tracking-wider text-fg-subtle uppercase">{title}</h3>
      {rows.map((r) => (
        <Link key={r.account.id} to={`/accounts/${r.account.id}?${query}`} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-surface-2">
          <span className="flex-1">{r.account.name}</span>
          <span className="tabular-nums">{f.money(r.amount)}</span>
        </Link>
      ))}
      {rows.length === 0 && <p className="px-3 py-1.5 text-sm text-fg-subtle">No tax accounts</p>}
      <TotalRow label={totalLabel} amount={total} />
    </div>
  )
  return (
    <ReportPage
      title={`${company.taxName} summary`}
      description="Tax collected on sales minus tax paid on purchases: what you owe the tax office for the period."
      period={period}
      controls={<DateRangeControl range={range} onChange={setRange} />}
      csv={() => [
        ['Account', 'Amount'],
        ...t.collected.map((r) => [r.account.name, f.toInput(r.amount) || '0']),
        ['Total collected', f.toInput(t.totalCollected) || '0'],
        ...t.claimable.map((r) => [r.account.name, f.toInput(r.amount) || '0']),
        ['Total claimable', f.toInput(t.totalClaimable) || '0'],
        ['Net payable', f.toInput(t.net) || '0'],
      ]}
    >
      {section('Collected on sales', t.collected, 'Total collected', t.totalCollected)}
      {section('Paid on purchases (claimable)', t.claimable, 'Total claimable', t.totalClaimable)}
      <TotalRow label={t.net >= 0 ? 'Net tax to pay' : 'Net tax to reclaim'} amount={t.net} strong />
      <p className="px-3 pt-2 pb-2 text-xs text-fg-subtle">Check filing rules with your tax adviser. Amounts come from posted transactions in the period.</p>
    </ReportPage>
  )
}

export function GeneralLedgerReport() {
  const company = useCompany()
  const f = useFormat()
  const { mode } = usePrefs()
  const [range, setRange] = useDateRange('this_month')
  const accounts = useAccounts(company.id)
  const before = useLines(company.id, MIN_DATE, addDays(range.from, -1))
  const within = useLines(company.id, range.from, range.to)
  const entries = useLiveQuery(async () => {
    if (!within) return undefined
    const list = await db.journalEntries.bulkGet([...new Set(within.map((l) => l.entryId))])
    return new Map(list.filter((e): e is JournalEntry => !!e).map((e) => [e.id, e]))
  }, [within])
  const sections = useMemo(() => (accounts && before && within && entries ? generalLedger(accounts, before, within, entries) : null), [accounts, before, within, entries])
  if (!sections) return <Spinner />
  const period = `${f.date(range.from)} – ${f.date(range.to)}`

  return (
    <ReportPage
      title="General ledger"
      description="Every transaction in every account, with running balances."
      period={period}
      controls={<DateRangeControl range={range} onChange={setRange} />}
      csv={() => [
        ['Account', 'Date', 'Number', 'Description', 'Debit', 'Credit', 'Balance'],
        ...sections.flatMap((s) => [
          [`${s.account.code} ${s.account.name}`, '', '', 'Opening balance', '', '', f.toInput(s.opening) || '0'],
          ...s.rows.map((r) => ['', r.line.date, r.entry?.number ?? '', r.line.description || r.entry?.memo || '', f.toInput(r.line.debit), f.toInput(r.line.credit), f.toInput(r.balance) || '0']),
        ]),
      ]}
    >
      {sections.length === 0 && <p className="px-3 py-8 text-center text-sm text-fg-subtle">No activity in this period.</p>}
      {sections.map((s) => (
        <div key={s.account.id} className="mb-5">
          <h3 className="flex items-baseline justify-between px-3 pt-3 pb-1 text-sm font-semibold">
            <Link to={`/accounts/${s.account.id}`} className="hover:text-primary-ink">
              {mode === 'accountant' && <span className="mr-2 text-fg-subtle">{s.account.code}</span>}
              {s.account.name}
            </Link>
            <span className="text-xs font-normal text-fg-subtle">Opening {f.money(s.opening)}</span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <tbody className="tabular-nums">
                {s.rows.map((r) => (
                  <tr key={r.line.id} className="border-b border-line">
                    <td className="w-28 px-3 py-1.5 text-fg-muted">{f.date(r.line.date)}</td>
                    <td className="px-3 py-1.5">
                      <Link to={`/journal/${r.line.entryId}`} className="hover:text-primary-ink">
                        {r.line.description || r.entry?.memo || r.entry?.number}
                      </Link>
                    </td>
                    <td className="w-28 px-3 py-1.5 text-right">{r.line.debit ? f.money(r.line.debit) : ''}</td>
                    <td className="w-28 px-3 py-1.5 text-right">{r.line.credit ? f.money(r.line.credit) : ''}</td>
                    <td className="w-32 px-3 py-1.5 text-right font-medium">{f.money(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TotalRow label="Closing balance" amount={s.closing} />
        </div>
      ))}
    </ReportPage>
  )
}

export function StockSummaryReport() {
  const company = useCompany()
  const f = useFormat()
  const items = useItems(company.id)
  const moves = useStockMoves(company.id)
  const [asOf, setAsOf] = useAsOf()
  const rows = useMemo(() => {
    if (!items || !moves) return null
    const levels = stockLevels(moves.filter((m) => m.date <= asOf))
    return items.filter((i) => i.trackStock).map((i) => ({ item: i, level: levels.get(i.id) ?? { quantity: 0, value: 0, averageCost: 0 } })).sort((a, b) => b.level.value - a.level.value)
  }, [items, moves, asOf])
  if (!rows) return <Spinner />
  const total = rows.reduce((s, r) => s + r.level.value, 0)
  return (
    <ReportPage
      title="Stock value"
      description="How much stock you hold and what it cost, at average cost."
      period={`As of ${f.date(asOf)}`}
      controls={<Input type="date" aria-label="As of" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="w-auto" />}
      csv={() => [['Item', 'Quantity', 'Average cost', 'Value'], ...rows.map((r) => [r.item.name, r.level.quantity, f.toInput(Math.round(r.level.averageCost)) || '0', f.toInput(r.level.value) || '0'])]}
    >
      <SimpleTable
        head={['Item', 'On hand', 'Average cost', 'Value']}
        rows={rows.map((r) => ({
          key: r.item.id,
          cells: [<Link to={`/items/${r.item.id}`} className="hover:text-primary-ink">{r.item.name}</Link>, `${r.level.quantity} ${r.item.unit ?? ''}`, f.money(Math.round(r.level.averageCost)), f.money(r.level.value)],
        }))}
        foot={['Total', '', '', f.money(total)]}
      />
    </ReportPage>
  )
}

function SimpleTable({ head, rows, foot }: { head: string[]; rows: { key: string; cells: React.ReactNode[] }[]; foot: React.ReactNode[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg-subtle">
            {head.map((h, i) => (
              <th key={h} className={cn(th, i > 0 && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line hover:bg-surface-2/50">
              {r.cells.map((c, i) => (
                <td key={i} className={cn(td, i > 0 && 'text-right')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={head.length} className="px-3 py-8 text-center text-fg-subtle">
                Nothing in this period.
              </td>
            </tr>
          )}
          <tr className="border-t-2 border-fg/70 font-semibold">
            {foot.map((c, i) => (
              <td key={i} className={cn(td, i > 0 && 'text-right')}>
                {c}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
