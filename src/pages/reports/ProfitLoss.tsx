import { useMemo } from 'react'
import { computeProfitLoss } from '../../accounting/reports'
import { DateRangeControl, useDateRange } from '../../components/DateRange'
import { Spinner } from '../../components/ui/misc'
import { useCompany, useFormat } from '../../state/company'
import { useAccounts, useLines } from '../../state/data'
import { ReportPage, SectionRows, sectionCsv, TotalRow } from './shared'

export function ProfitLossReport() {
  const company = useCompany()
  const f = useFormat()
  const [range, setRange] = useDateRange('this_fy')
  const accounts = useAccounts(company.id)
  const lines = useLines(company.id, range.from, range.to)
  const pl = useMemo(() => (accounts && lines ? computeProfitLoss(accounts, lines) : null), [accounts, lines])

  if (!pl) return <Spinner />
  const linkQuery = `preset=custom&from=${range.from}&to=${range.to}`
  const period = `${f.date(range.from)} – ${f.date(range.to)}`
  const margin = pl.income.total ? Math.round((pl.netProfit / pl.income.total) * 1000) / 10 : null

  return (
    <ReportPage
      title="Profit & loss"
      description="Did the business make money? Income minus expenses for the period."
      period={period}
      controls={<DateRangeControl range={range} onChange={setRange} />}
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
      <SectionRows section={pl.income} linkQuery={linkQuery} />
      {(pl.costOfSales.rows.length > 0 || pl.costOfSales.total !== 0) && (
        <>
          <SectionRows section={pl.costOfSales} linkQuery={linkQuery} />
          <TotalRow label="Gross profit" amount={pl.grossProfit} />
        </>
      )}
      <SectionRows section={pl.expenses} linkQuery={linkQuery} />
      {(pl.otherIncome.rows.length > 0 || pl.otherExpenses.rows.length > 0) && (
        <>
          <TotalRow label="Operating profit" amount={pl.operatingProfit} />
          {pl.otherIncome.rows.length > 0 && <SectionRows section={pl.otherIncome} linkQuery={linkQuery} />}
          {pl.otherExpenses.rows.length > 0 && <SectionRows section={pl.otherExpenses} linkQuery={linkQuery} />}
        </>
      )}
      <TotalRow label={pl.netProfit >= 0 ? 'Net profit' : 'Net loss'} amount={pl.netProfit} strong />
      {margin !== null && <p className="px-3 pt-1 pb-2 text-right text-xs text-fg-subtle">Net margin {margin}%</p>}
    </ReportPage>
  )
}
