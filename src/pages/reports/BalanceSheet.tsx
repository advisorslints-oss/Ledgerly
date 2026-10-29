import { CircleAlert, CircleCheck } from 'lucide-react'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { computeBalanceSheet } from '../../accounting/reports'
import { Input, Select } from '../../components/ui/form'
import { Spinner } from '../../components/ui/misc'
import { addDays, endOfMonth, fiscalYearStart, startOfMonth, today } from '../../lib/dates'
import { useCompany, useFormat } from '../../state/company'
import { useAccounts, useLines } from '../../state/data'
import { ReportPage, SectionRows, sectionCsv, TotalRow } from './shared'

export function BalanceSheetReport() {
  const company = useCompany()
  const f = useFormat()
  const [params, setParams] = useSearchParams()
  const asOf = params.get('to') || today()
  const accounts = useAccounts(company.id)
  const lines = useLines(company.id, undefined, asOf)
  const fyStart = fiscalYearStart(asOf, company.fiscalYearStartMonth)
  const bs = useMemo(() => (accounts && lines ? computeBalanceSheet(accounts, lines, fyStart) : null), [accounts, lines, fyStart])

  if (!bs) return <Spinner />

  const presets = [
    { label: 'Today', value: today() },
    { label: 'End of last month', value: addDays(startOfMonth(today()), -1) },
    { label: 'End of this month', value: endOfMonth(today()) },
    { label: 'End of last financial year', value: addDays(fiscalYearStart(today(), company.fiscalYearStartMonth), -1) },
  ]
  const preset = presets.find((p) => p.value === asOf)?.value ?? 'custom'
  const setAsOf = (to: string) => setParams({ to }, { replace: true })
  const linkQuery = `preset=custom&from=${fyStart}&to=${asOf}`
  const period = `As of ${f.date(asOf)}`

  return (
    <ReportPage
      title="Balance sheet"
      description="What the business owns and owes on a date, and the owners' share."
      period={period}
      controls={
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="As of" value={preset} onChange={(e) => e.target.value !== 'custom' && setAsOf(e.target.value)} className="w-auto min-w-52">
            {presets.map((p) => (
              <option key={p.label} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom date</option>
          </Select>
          <Input type="date" aria-label="As of date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="w-auto" />
        </div>
      }
      csv={() => [
        ['Balance sheet', period],
        ['', ''],
        ...sectionCsv(bs.currentAssets, f.toInput),
        ...sectionCsv(bs.fixedAssets, f.toInput),
        ...(bs.otherAssets.rows.length ? sectionCsv(bs.otherAssets, f.toInput) : []),
        ['Total assets', f.toInput(bs.totalAssets) || '0'],
        ['', ''],
        ...sectionCsv(bs.currentLiabilities, f.toInput),
        ...sectionCsv(bs.longTermLiabilities, f.toInput),
        ['Total liabilities', f.toInput(bs.totalLiabilities) || '0'],
        ['', ''],
        ...sectionCsv(bs.equity, f.toInput),
        ['Total liabilities and equity', f.toInput(bs.totalLiabilities + bs.equity.total) || '0'],
      ]}
    >
      <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
        <div>
          <SectionRows section={bs.currentAssets} linkQuery={linkQuery} emptyText="None" />
          <SectionRows section={bs.fixedAssets} linkQuery={linkQuery} emptyText="None" />
          {bs.otherAssets.rows.length > 0 && <SectionRows section={bs.otherAssets} linkQuery={linkQuery} />}
          <TotalRow label="Total assets" amount={bs.totalAssets} strong />
        </div>
        <div className="mt-6 lg:mt-0">
          <SectionRows section={bs.currentLiabilities} linkQuery={linkQuery} emptyText="None" />
          <SectionRows section={bs.longTermLiabilities} linkQuery={linkQuery} emptyText="None" />
          <SectionRows section={bs.equity} linkQuery={linkQuery} emptyText="None" />
          <TotalRow label="Total liabilities & equity" amount={bs.totalLiabilities + bs.equity.total} strong />
        </div>
      </div>
      <p className="mt-4 flex items-center justify-center gap-1.5 px-3 pb-2 text-xs text-fg-subtle">
        {bs.difference === 0 ? (
          <>
            <CircleCheck className="size-3.5 text-success" /> Assets equal liabilities plus equity
          </>
        ) : (
          <>
            <CircleAlert className="size-3.5 text-danger" /> Out of balance by {f.money(bs.difference)}
          </>
        )}
      </p>
    </ReportPage>
  )
}
