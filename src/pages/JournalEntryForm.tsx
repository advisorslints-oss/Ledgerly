import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, CircleAlert, CircleCheck, Plus, Scale, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { checkEntry, postEntry } from '../accounting/engine'
import { errorMessage } from '../accounting/errors'
import { AccountPicker } from '../components/AccountPicker'
import { AmountInput } from '../components/AmountInput'
import { Button } from '../components/ui/button'
import { Field, Input } from '../components/ui/form'
import { Card, Help, Kbd, PageHeader, Spinner } from '../components/ui/misc'
import { useToast } from '../components/ui/toast'
import { db } from '../db'
import { cn } from '../lib/cn'
import { today } from '../lib/dates'
import { useCompany, useFormat } from '../state/company'
import { useAccounts } from '../state/data'
import { usePrefs } from '../state/prefs'

interface Row {
  key: number
  accountId: string
  debit: number
  credit: number
  description: string
}

let rowKey = 1
const blank = (): Row => ({ key: rowKey++, accountId: '', debit: 0, credit: 0, description: '' })

export function JournalEntryForm() {
  const company = useCompany()
  const f = useFormat()
  const { mode } = usePrefs()
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const copyFrom = params.get('copy')
  const accounts = useAccounts(company.id)
  const source = useLiveQuery(async () => {
    if (!copyFrom) return null
    const entry = await db.journalEntries.get(copyFrom)
    const lines = await db.journalLines.where('entryId').equals(copyFrom).sortBy('order')
    return entry ? { entry, lines } : null
  }, [copyFrom])

  const [date, setDate] = useState(today())
  const [memo, setMemo] = useState('')
  const [reference, setReference] = useState('')
  const [rows, setRows] = useState<Row[]>(() => [blank(), blank()])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (!source) return
    setMemo(source.entry.memo)
    setReference(source.entry.reference ?? '')
    setRows(source.lines.map((l) => ({ key: rowKey++, accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description ?? '' })))
  }, [source])

  const accountMap = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a])), [accounts])
  const check = useMemo(() => checkEntry(rows, accountMap, company.id), [rows, accountMap, company.id])

  const update = (key: number, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  /** Puts the amount that would balance the entry on the first row that has an account but no amount. */
  const balance = () => {
    const diff = check.difference
    if (!diff) return
    setRows((list) => {
      const target = list.find((r) => !r.debit && !r.credit) ?? null
      if (!target) return [...list, { ...blank(), debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0 }]
      return list.map((r) => (r.key === target.key ? { ...r, debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0 } : r))
    })
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    setAttempted(true)
    setError(null)
    if (!check.ok) return setError(check.errors[0])
    setBusy(true)
    try {
      const entry = await postEntry(db, { companyId: company.id, date, memo, reference, lines: rows })
      toast(`Posted ${entry.number}`)
      navigate(`/journal/${entry.id}`, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  if (!accounts || (copyFrom && source === undefined)) return <Spinner />
  const showCodes = mode === 'accountant'

  return (
    <div>
      <PageHeader
        back={
          <Link to="/journal" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> {mode === 'simple' ? 'Transactions' : 'Journal'}
          </Link>
        }
        title={copyFrom ? 'Copy journal entry' : 'New journal entry'}
        description={
          <>
            Each line moves money into (debit) or out of (credit) an account. Total debits must equal total credits.{' '}
            <Help>
              Debits increase assets and expenses. Credits increase liabilities, equity and income. Example: paying rent is a debit to Rent and a credit to Bank.
            </Help>
          </>
        }
      />

      <form
        ref={formRef}
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      >
        <Card className="p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[11rem_minmax(0,1fr)_12rem]">
            <Field label="Date">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
            <Field label="Description">{(id) => <Input id={id} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What is this entry for?" maxLength={200} />}</Field>
            <Field label="Reference">{(id) => <Input id={id} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" maxLength={60} />}</Field>
          </div>
        </Card>

        <Card className="mt-4">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_9rem_9rem_2.25rem] gap-3 border-b border-line px-5 py-2.5 text-xs font-medium text-fg-subtle md:grid">
            <span>Account</span>
            <span>Line note</span>
            <span className="text-right">Debit</span>
            <span className="text-right">Credit</span>
            <span />
          </div>
          <div className="divide-y divide-line">
            {rows.map((row, i) => {
              const lineError = attempted && check.errors.find((er) => er.startsWith(`Line ${i + 1}:`))
              return (
                <div key={row.key} className="px-5 py-3">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_9rem_9rem_2.25rem] md:items-center">
                    <AccountPicker
                      className="col-span-2 md:col-span-1"
                      aria-label={`Line ${i + 1} account`}
                      accounts={accounts}
                      value={row.accountId}
                      onChange={(accountId) => update(row.key, { accountId })}
                      showCodes={showCodes}
                      invalid={!!lineError && !row.accountId}
                    />
                    <Input
                      className="col-span-2 md:col-span-1"
                      aria-label={`Line ${i + 1} note`}
                      value={row.description}
                      onChange={(e) => update(row.key, { description: e.target.value })}
                      placeholder="Optional note"
                      maxLength={200}
                    />
                    <label className="flex flex-col gap-1 md:block">
                      <span className="text-xs text-fg-subtle md:sr-only">Debit</span>
                      <AmountInput value={row.debit} onChange={(debit) => update(row.key, { debit, credit: debit ? 0 : row.credit })} aria-label={`Line ${i + 1} debit`} />
                    </label>
                    <label className="flex flex-col gap-1 md:block">
                      <span className="text-xs text-fg-subtle md:sr-only">Credit</span>
                      <AmountInput value={row.credit} onChange={(credit) => update(row.key, { credit, debit: credit ? 0 : row.debit })} aria-label={`Line ${i + 1} credit`} />
                    </label>
                    <button
                      type="button"
                      onClick={() => setRows((list) => (list.length > 2 ? list.filter((r) => r.key !== row.key) : list.map((r) => (r.key === row.key ? blank() : r))))}
                      aria-label={`Remove line ${i + 1}`}
                      className="col-span-2 grid h-9 place-items-center rounded-lg text-fg-subtle hover:bg-danger-soft hover:text-danger md:col-span-1 md:size-9"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  {lineError && <p className="mt-1.5 text-xs text-danger">{lineError.replace(/^Line \d+: /, '')}</p>}
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
            <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setRows((list) => [...list, blank()])}>
              Add line
            </Button>
            {check.difference !== 0 && (
              <Button size="sm" variant="soft" icon={<Scale />} onClick={balance}>
                Balance it
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 border-t border-line bg-surface-2/50 px-5 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_9rem_9rem_2.25rem] md:gap-3">
            <div className="flex items-center gap-2 text-sm md:col-span-2">
              {check.difference === 0 && check.totalDebit > 0 ? (
                <>
                  <CircleCheck className="size-4 text-success" />
                  <span className="text-fg-muted">Balanced</span>
                </>
              ) : (
                <>
                  <CircleAlert className="size-4 text-warning" />
                  <span className="text-fg-muted">
                    {check.totalDebit === 0 && check.totalCredit === 0 ? 'Enter amounts' : `Out of balance by ${f.money(Math.abs(check.difference))}`}
                  </span>
                </>
              )}
            </div>
            <div className="flex justify-between text-sm font-semibold tabular-nums md:block md:text-right">
              <span className="text-fg-subtle md:hidden">Total debits</span>
              {f.money(check.totalDebit)}
            </div>
            <div className="flex justify-between text-sm font-semibold tabular-nums md:block md:text-right">
              <span className="text-fg-subtle md:hidden">Total credits</span>
              {f.money(check.totalCredit)}
            </div>
          </div>
        </Card>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
          <span className={cn('hidden items-center gap-1 text-xs text-fg-subtle lg:inline-flex')}>
            <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> to post
          </span>
          <Button onClick={() => navigate(-1)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !check.ok} size="lg">
            Post entry
          </Button>
        </div>
      </form>
    </div>
  )
}
