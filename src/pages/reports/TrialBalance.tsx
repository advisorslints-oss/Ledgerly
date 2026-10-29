import { CircleAlert, CircleCheck } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { computeTrialBalance } from '../../accounting/reports'
import { Input } from '../../components/ui/form'
import { Spinner } from '../../components/ui/misc'
import { fiscalYearStart, today } from '../../lib/dates'
import { useCompany, useFormat } from '../../state/company'
import { useAccounts, useLines } from '../../state/data'
import { ReportPage } from './shared'

export function TrialBalanceReport() {
  const company = useCompany()
  const f = useFormat()
  const [params, setParams] = useSearchParams()
  const asOf = params.get('to') || today()
  const accounts = useAccounts(company.id)
  const lines = useLines(company.id, undefined, asOf)
  const tb = useMemo(() => (accounts && lines ? computeTrialBalance(accounts, lines) : null), [accounts, lines])

  if (!tb) return <Spinner />
  const period = `As of ${f.date(asOf)}`
  const linkQuery = `preset=custom&from=${fiscalYearStart(asOf, company.fiscalYearStartMonth)}&to=${asOf}`
  const balanced = tb.totalDebit === tb.totalCredit

  return (
    <ReportPage
      title="Trial balance"
      description="Every account's balance as debits and credits. The two columns must always match."
      period={period}
      controls={<Input type="date" aria-label="As of date" value={asOf} onChange={(e) => e.target.value && setParams({ to: e.target.value }, { replace: true })} className="w-auto" />}
      csv={() => [
        ['Code', 'Account', 'Debit', 'Credit'],
        ...tb.rows.map((r) => [r.account.code, r.account.name, f.toInput(r.debit), f.toInput(r.credit)]),
        ['', 'Total', f.toInput(tb.totalDebit) || '0', f.toInput(tb.totalCredit) || '0'],
      ]}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-fg-subtle">
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 text-right font-medium">Debit</th>
              <th className="px-3 py-2 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {tb.rows.map((r) => (
              <tr key={r.account.id} className="border-b border-line hover:bg-surface-2/50">
                <td className="px-3 py-2">
                  <Link to={`/accounts/${r.account.id}?${linkQuery}`} className="text-fg hover:text-primary-ink">
                    <span className="mr-2 text-xs text-fg-subtle">{r.account.code}</span>
                    {r.account.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right">{r.debit ? f.money(r.debit) : ''}</td>
                <td className="px-3 py-2 text-right">{r.credit ? f.money(r.credit) : ''}</td>
              </tr>
            ))}
            {tb.rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-fg-subtle">
                  No balances yet.
                </td>
              </tr>
            )}
            <tr className="border-t-2 border-fg/70 font-semibold">
              <td className="px-3 py-2.5">Total</td>
              <td className="px-3 py-2.5 text-right">{f.money(tb.totalDebit)}</td>
              <td className="px-3 py-2.5 text-right">{f.money(tb.totalCredit)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 flex items-center justify-center gap-1.5 pb-2 text-xs text-fg-subtle">
        {balanced ? <CircleCheck className="size-3.5 text-success" /> : <CircleAlert className="size-3.5 text-danger" />}
        {balanced ? 'Debits equal credits' : `Out of balance by ${f.money(Math.abs(tb.totalDebit - tb.totalCredit))}`}
      </p>
    </ReportPage>
  )
}
