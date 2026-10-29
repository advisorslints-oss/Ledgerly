import { useLiveQuery } from 'dexie-react-hooks'
import { Info } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ACCOUNT_TYPES, TYPE_LABELS } from '../accounting/accounts'
import { isDebitNormal, setOpeningBalances } from '../accounting/engine'
import { errorMessage } from '../accounting/errors'
import { AmountInput } from '../components/AmountInput'
import { Button } from '../components/ui/button'
import { Field, Input, Switch } from '../components/ui/form'
import { Card, PageHeader, Spinner } from '../components/ui/misc'
import { useToast } from '../components/ui/toast'
import { db } from '../db'
import type { AccountType } from '../db/types'
import { addDays, fiscalYearStart, today } from '../lib/dates'
import { useCompany, useFormat } from '../state/company'
import { useAccounts } from '../state/data'
import { usePrefs } from '../state/prefs'

const BALANCE_SHEET: AccountType[] = ['asset', 'liability', 'equity']

export function OpeningBalances() {
  const company = useCompany()
  const f = useFormat()
  const { mode } = usePrefs()
  const toast = useToast()
  const navigate = useNavigate()
  const accounts = useAccounts(company.id)
  const existing = useLiveQuery(async () => {
    const entry = await db.journalEntries
      .where('companyId')
      .equals(company.id)
      .filter((e) => e.source === 'opening' && e.status === 'posted')
      .first()
    const lines = entry ? await db.journalLines.where('entryId').equals(entry.id).toArray() : []
    return { entry: entry ?? null, lines }
  }, [company.id])

  const [date, setDate] = useState(() => addDays(fiscalYearStart(today(), company.fiscalYearStartMonth), -1))
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const [includePL, setIncludePL] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!existing || !accounts || loaded) return
    const map: Record<string, number> = {}
    for (const l of existing.lines) {
      const a = accounts.find((x) => x.id === l.accountId)
      if (!a || a.systemKey === 'opening_balance') continue
      map[a.id] = isDebitNormal(a.type) ? l.debit - l.credit : l.credit - l.debit
    }
    if (existing.entry) setDate(existing.entry.date)
    setIncludePL(Object.keys(map).some((id) => ['income', 'expense'].includes(accounts.find((a) => a.id === id)?.type ?? '')))
    setAmounts(map)
    setLoaded(true)
  }, [existing, accounts, loaded])

  const types = includePL ? ACCOUNT_TYPES : BALANCE_SHEET
  const groups = useMemo(
    () =>
      types.map((type) => ({
        type,
        items: (accounts ?? []).filter((a) => a.type === type && !a.archived && a.systemKey !== 'opening_balance').sort((x, y) => x.code.localeCompare(y.code)),
      })),
    [accounts, types],
  )

  const totals = useMemo(() => {
    let debit = 0
    let credit = 0
    for (const a of accounts ?? []) {
      const amt = amounts[a.id]
      if (!amt || !types.includes(a.type)) continue
      if (isDebitNormal(a.type) === amt > 0) debit += Math.abs(amt)
      else credit += Math.abs(amt)
    }
    return { debit, credit, offset: debit - credit }
  }, [accounts, amounts, types])

  if (!accounts || !existing) return <Spinner />

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const list = accounts.filter((a) => types.includes(a.type) && amounts[a.id]).map((a) => ({ accountId: a.id, amount: amounts[a.id] }))
      await setOpeningBalances(db, company.id, date, list)
      toast(list.length ? 'Opening balances saved' : 'Opening balances cleared')
      navigate('/accounts')
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader description="Moving from another system or starting mid-way? Enter what each account held on the day before you start using Ledgerly." />

      <Card className="mb-4 p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
          <Field label="Balances as of" hint="Usually the last day of your previous financial year." className="sm:w-64">
            {(id, d) => <Input id={id} aria-describedby={d} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <div className="sm:mb-5 sm:ml-auto">
            <Switch checked={includePL} onChange={setIncludePL} label="Include income & expenses" description="Only if you start partway through a financial year." />
          </div>
        </div>
      </Card>

      <div className="mb-4 flex items-start gap-3 rounded-xl border border-line bg-primary-soft/60 px-4 py-3 text-sm text-fg-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-primary-ink" />
        <p>
          Enter amounts as normal positive numbers: the money in your bank, what customers owe you, what you owe on loans. Use a minus sign only for unusual balances, such as
          an overdrawn bank. Any difference goes to <strong className="font-medium text-fg">Opening Balance Equity</strong>.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <Card key={g.type} className="overflow-hidden">
            <h2 className="border-b border-line bg-surface-2/50 px-5 py-3 text-sm font-semibold">{TYPE_LABELS[g.type]}</h2>
            <ul className="divide-y divide-line">
              {g.items.map((a) => (
                <li key={a.id} className="flex items-center gap-4 px-5 py-2.5">
                  <label htmlFor={`ob-${a.id}`} className="min-w-0 flex-1 text-sm text-fg">
                    {mode === 'accountant' && <span className="mr-2 text-xs text-fg-subtle tabular-nums">{a.code}</span>}
                    {a.name}
                  </label>
                  <AmountInput id={`ob-${a.id}`} allowNegative value={amounts[a.id] ?? 0} onChange={(v) => setAmounts((m) => ({ ...m, [a.id]: v }))} className="w-40 sm:w-48" />
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 mt-6 lg:bottom-4">
        <Card className="flex flex-col gap-3 p-4 shadow-pop sm:flex-row sm:items-center">
          <div className="flex-1 text-sm">
            <span className="text-fg-muted">Opening Balance Equity: </span>
            <span className="font-semibold tabular-nums">{f.money(totals.offset)}</span>
            {error && <p className="mt-1 text-danger">{error}</p>}
          </div>
          <Button onClick={() => navigate('/accounts')}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            Save opening balances
          </Button>
        </Card>
      </div>
    </div>
  )
}
