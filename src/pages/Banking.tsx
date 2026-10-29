import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Check, CheckCircle2, CircleAlert, Landmark, ListChecks, Pencil, Plus, Trash2, Undo2, Upload, Wallet, WandSparkles } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  completeReconciliation,
  deleteBankRule,
  findMatches,
  guessColumns,
  guessDateFormat,
  importStatement,
  mapRows,
  matchBankLine,
  naturalAmount,
  openingReconciledBalance,
  parseCsv,
  reconciledLineIds,
  recordBankLine,
  ruleFor,
  saveBankRule,
  saveReconciliation,
  setBankLineIgnored,
  undoReconciliation,
  type ColumnMap,
  type DateFormat,
} from '../accounting/banking'
import { errorMessage } from '../accounting/errors'
import { naturalBalance, totalsByAccount } from '../accounting/reports'
import { AccountDialog } from '../components/AccountDialog'
import { AccountPicker } from '../components/AccountPicker'
import { AmountInput } from '../components/AmountInput'
import { useQuickEntry } from '../components/QuickEntry'
import { Button, LinkButton } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'
import { Field, Input, Select } from '../components/ui/form'
import { Badge, Card, EmptyState, Segmented, Spinner } from '../components/ui/misc'
import { useToast } from '../components/ui/toast'
import { db } from '../db'
import type { Account, BankLine, BankRule, JournalEntry, JournalLine } from '../db/types'
import { cn } from '../lib/cn'
import { today } from '../lib/dates'
import { useCompany, useFormat } from '../state/company'
import { useAccounts } from '../state/data'
import { usePrefs } from '../state/prefs'

const MONEY = new Set(['cash', 'bank', 'credit_card'])

function useMoneyAccounts() {
  const company = useCompany()
  const accounts = useAccounts(company.id)
  return { accounts, money: accounts?.filter((a) => MONEY.has(a.subtype) && !a.archived).sort((a, b) => a.code.localeCompare(b.code)) }
}

/** The bank account chosen in the URL (?account=), defaulting to the main bank account. */
function useChosenAccount(money: Account[] | undefined) {
  const [params, setParams] = useSearchParams()
  const id = params.get('account')
  const account = money?.find((a) => a.id === id) ?? money?.find((a) => a.systemKey === 'bank') ?? money?.[0]
  const choose = (next: string) => setParams((p) => (p.set('account', next), p), { replace: true })
  return [account, choose] as const
}

function AccountSelect({ money, value, onChange }: { money: Account[]; value?: string; onChange: (id: string) => void }) {
  return (
    <Select aria-label="Account" value={value} onChange={(e) => onChange(e.target.value)} className="w-auto min-w-56">
      {money.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </Select>
  )
}

// ---------- Accounts ----------

export function BankAccounts() {
  const company = useCompany()
  const f = useFormat()
  const openQuick = useQuickEntry()
  const { accounts, money } = useMoneyAccounts()
  const lines = useLiveQuery(() => db.journalLines.where('companyId').equals(company.id).toArray(), [company.id])
  const bankLines = useLiveQuery(() => db.bankLines.where('companyId').equals(company.id).toArray(), [company.id])
  const recs = useLiveQuery(() => db.reconciliations.where('companyId').equals(company.id).toArray(), [company.id])
  const [adding, setAdding] = useState(false)
  if (!accounts || !money || !lines || !bankLines || !recs) return <Spinner />
  const totals = totalsByAccount(lines.filter((l) => l.date <= today()))

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button icon={<ArrowLeftRight />} onClick={() => openQuick('transfer')}>
          Transfer money
        </Button>
        <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)} className="ml-auto">
          Add bank account
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {money.map((a) => {
          const balance = naturalBalance(a.type, totals.get(a.id) ?? { debit: 0, credit: 0 })
          const toReview = bankLines.filter((l) => l.accountId === a.id && l.status === 'new').length
          const last = recs.filter((r) => r.accountId === a.id && r.status === 'completed').sort((x, y) => y.statementDate.localeCompare(x.statementDate))[0]
          return (
            <Card key={a.id} className="flex flex-col p-5">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-ink">{a.subtype === 'cash' ? <Wallet className="size-5" /> : <Landmark className="size-5" />}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold">{a.name}</h3>
                  <p className="text-xs text-fg-subtle">{a.subtype === 'cash' ? 'Cash' : a.subtype === 'credit_card' ? 'Credit card' : 'Bank account'}</p>
                </div>
              </div>
              <p className={cn('mt-4 text-2xl font-semibold tracking-tight', balance < 0 && 'text-danger')}>{f.money(balance)}</p>
              <p className="text-xs text-fg-subtle">{a.subtype === 'credit_card' ? 'Owed on the card' : 'Balance in your books'}</p>
              <div className="mt-4 space-y-1.5 text-sm">
                <p className="flex items-center gap-2 text-fg-muted">
                  {toReview ? <CircleAlert className="size-4 text-warning" /> : <CheckCircle2 className="size-4 text-success" />}
                  {toReview ? `${toReview} statement line${toReview > 1 ? 's' : ''} to review` : 'Nothing to review'}
                </p>
                <p className="flex items-center gap-2 text-fg-muted">
                  <ListChecks className="size-4" />
                  {last ? `Reconciled to ${f.date(last.statementDate)}` : 'Never reconciled'}
                </p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                <LinkButton size="sm" to={`/banking/transactions?account=${a.id}`}>
                  Transactions
                </LinkButton>
                <LinkButton size="sm" to={`/banking/review?account=${a.id}`} variant={toReview ? 'soft' : 'secondary'}>
                  Review
                </LinkButton>
                <LinkButton size="sm" to={`/banking/reconcile?account=${a.id}`}>
                  Reconcile
                </LinkButton>
              </div>
            </Card>
          )
        })}
      </div>
      <AccountDialog open={adding} onClose={() => setAdding(false)} accounts={accounts} defaults={{ type: 'asset', subtype: 'bank' }} />
    </div>
  )
}

// ---------- Transactions ----------

export function BankTransactions() {
  const f = useFormat()
  const openQuick = useQuickEntry()
  const { money } = useMoneyAccounts()
  const [account, choose] = useChosenAccount(money)
  const data = useLiveQuery(async () => {
    if (!account) return null
    const lines = await db.journalLines.where('[accountId+date]').between([account.id, ''], [account.id, '￿']).toArray()
    const entries = await db.journalEntries.bulkGet([...new Set(lines.map((l) => l.entryId))])
    const recs = await db.reconciliations.where('accountId').equals(account.id).toArray()
    return { lines, entries: new Map(entries.filter((e): e is JournalEntry => !!e).map((e) => [e.id, e])), reconciled: reconciledLineIds(recs) }
  }, [account?.id])
  const [query, setQuery] = useState('')

  if (!money || data === undefined) return <Spinner />
  if (!account || !data) return <Card><EmptyState title="No bank accounts" description="Add a bank or cash account first." /></Card>

  const sorted = [...data.lines].sort((a, b) => a.date.localeCompare(b.date) || (data.entries.get(a.entryId)?.createdAt ?? 0) - (data.entries.get(b.entryId)?.createdAt ?? 0))
  let running = 0
  const rows = sorted.map((l) => ({ l, entry: data.entries.get(l.entryId), balance: (running += naturalAmount(account, l)) })).reverse()
  const q = query.trim().toLowerCase()
  const visible = rows.filter((r) => !q || r.entry?.memo.toLowerCase().includes(q) || r.entry?.number.toLowerCase().includes(q) || f.toInput(r.l.debit || r.l.credit).startsWith(q))

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <AccountSelect money={money} value={account.id} onChange={choose} />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search transactions" className="sm:w-64" />
        <div className="flex gap-2 sm:ml-auto">
          <Button icon={<ArrowUpRight />} onClick={() => openQuick('out')}>
            Money out
          </Button>
          <Button variant="primary" icon={<ArrowDownLeft />} onClick={() => openQuick('in')}>
            Money in
          </Button>
        </div>
      </div>
      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState title="No transactions" description="Money in and out of this account will show here." />
        ) : (
          <ul className="divide-y divide-line">
            {visible.slice(0, 300).map(({ l, entry, balance }) => {
              const amount = naturalAmount(account, l)
              return (
                <li key={l.id}>
                  <Link to={`/journal/${l.entryId}`} className="flex items-center gap-4 px-5 py-3 hover:bg-surface-2/60">
                    <span className="w-20 shrink-0 text-xs text-fg-subtle sm:w-24">{f.date(l.date)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{entry?.memo || 'Transaction'}</span>
                      <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
                        {entry?.number}
                        {data.reconciled.has(l.id) && (
                          <span className="inline-flex items-center gap-0.5 text-success">
                            <Check className="size-3" /> Reconciled
                          </span>
                        )}
                      </span>
                    </span>
                    <span className={cn('w-28 text-right text-sm font-semibold tabular-nums', amount > 0 ? 'text-success' : 'text-fg')}>
                      {amount > 0 ? '+' : ''}
                      {f.money(amount)}
                    </span>
                    <span className="hidden w-28 text-right text-sm text-fg-muted tabular-nums sm:block">{f.money(balance)}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

// ---------- Statement review ----------

export function BankReview() {
  const company = useCompany()
  const f = useFormat()
  const toast = useToast()
  const { accounts, money } = useMoneyAccounts()
  const [account, choose] = useChosenAccount(money)
  const [tab, setTab] = useState<'new' | 'done'>('new')
  const [importing, setImporting] = useState(false)
  const data = useLiveQuery(async () => {
    if (!account) return null
    const [lines, journal, rules] = await Promise.all([
      db.bankLines.where('[accountId+date]').between([account.id, ''], [account.id, '￿']).toArray(),
      db.journalLines.where('[accountId+date]').between([account.id, ''], [account.id, '￿']).toArray(),
      db.bankRules.where('companyId').equals(company.id).toArray(),
    ])
    const entries = await db.journalEntries.bulkGet([...new Set(journal.map((l) => l.entryId))])
    return { lines, journal, rules, entries: new Map(entries.filter((e): e is JournalEntry => !!e).map((e) => [e.id, e])) }
  }, [account?.id, company.id])

  if (!money || !accounts || data === undefined) return <Spinner />
  if (!account || !data) return <Card><EmptyState title="No bank accounts" description="Add a bank or cash account first." /></Card>

  const used = new Set(data.lines.map((l) => l.journalLineId).filter((x): x is string => !!x))
  const toReview = data.lines.filter((l) => l.status === 'new').sort((a, b) => a.date.localeCompare(b.date))
  const done = data.lines.filter((l) => l.status !== 'new').sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <AccountSelect money={money} value={account.id} onChange={choose} />
        <Segmented
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'new', label: `To review (${toReview.length})` },
            { value: 'done', label: 'Done' },
          ]}
        />
        <Button variant="primary" icon={<Upload />} onClick={() => setImporting(true)} className="sm:ml-auto">
          Import statement
        </Button>
      </div>

      {tab === 'new' ? (
        toReview.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Upload />}
              title="All caught up"
              description="Download a statement from your bank's website as a CSV file and import it. Each line is matched to what you've recorded, or you can record it in one click."
              action={<Button variant="primary" icon={<Upload />} onClick={() => setImporting(true)}>Import statement</Button>}
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {toReview.map((line) => (
              <ReviewCard key={line.id} line={line} accounts={accounts} match={findMatches(line, data.journal, used)[0]} entries={data.entries} rule={ruleFor(line, data.rules)} />
            ))}
          </div>
        )
      ) : (
        <Card className="overflow-hidden">
          {done.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-fg-subtle">Nothing reviewed yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {done.map((l) => {
                const jl = data.journal.find((j) => j.id === l.journalLineId)
                return (
                  <li key={l.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                    <span className="w-20 shrink-0 text-xs text-fg-subtle sm:w-24">{f.date(l.date)}</span>
                    <span className="min-w-0 flex-1 truncate">{l.description}</span>
                    <Badge tone={l.status === 'ignored' ? 'neutral' : 'success'}>{l.status === 'matched' ? 'Matched' : l.status === 'recorded' ? 'Recorded' : 'Ignored'}</Badge>
                    {jl && (
                      <Link to={`/journal/${jl.entryId}`} className="hidden text-xs text-primary-ink hover:underline sm:inline">
                        View
                      </Link>
                    )}
                    <span className={cn('w-28 text-right font-medium tabular-nums', l.amount > 0 && 'text-success')}>{f.money(l.amount)}</span>
                    {l.status !== 'recorded' && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Undo"
                        onClick={async () => {
                          try {
                            await setBankLineIgnored(db, l.id, false)
                          } catch (err) {
                            toast(errorMessage(err), 'error')
                          }
                        }}
                      >
                        <Undo2 />
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      )}
      {importing && <ImportDialog account={account} onClose={() => setImporting(false)} />}
    </div>
  )
}

function ReviewCard({ line, accounts, match, entries, rule }: { line: BankLine; accounts: Account[]; match?: JournalLine; entries: Map<string, JournalEntry>; rule?: BankRule }) {
  const company = useCompany()
  const f = useFormat()
  const toast = useToast()
  const { mode } = usePrefs()
  const [category, setCategory] = useState(rule?.accountId ?? '')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const keyword = line.description.replace(/[\d#*/\\-]+/g, ' ').trim().split(/\s+/).filter((w) => w.length > 2).slice(0, 2).join(' ')
  const entry = match ? entries.get(match.entryId) : undefined

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true)
    try {
      await fn()
      toast(message)
    } catch (err) {
      toast(errorMessage(err), 'error')
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-fg-subtle">{f.date(line.date)}</p>
          <p className="truncate font-medium">{line.description}</p>
        </div>
        <p className={cn('text-lg font-semibold tabular-nums', line.amount > 0 ? 'text-success' : 'text-fg')}>
          {line.amount > 0 ? '+' : ''}
          {f.money(line.amount)}
        </p>
      </div>
      {match && entry ? (
        <div className="mt-3 flex flex-col gap-3 rounded-xl bg-success-soft/60 p-3 sm:flex-row sm:items-center">
          <WandSparkles className="size-4 shrink-0 text-success" />
          <p className="min-w-0 flex-1 text-sm">
            Matches <strong className="font-medium">{entry.memo || entry.number}</strong> <span className="text-fg-subtle">· {entry.number} · {f.date(match.date)}</span>
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={busy} onClick={() => act(() => matchBankLine(db, line.id, match.id), 'Matched')}>
              Match
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => setBankLineIgnored(db, line.id, true), 'Ignored')}>
              Ignore
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <AccountPicker
              className="flex-1"
              aria-label="What was this for?"
              accounts={accounts.filter((a) => a.id !== line.accountId)}
              value={category}
              onChange={setCategory}
              showCodes={mode === 'accountant'}
              groupOrder={line.amount > 0 ? ['income', 'liability', 'equity', 'asset', 'expense'] : ['expense', 'asset', 'liability', 'equity', 'income']}
              placeholder={line.amount > 0 ? 'What was this money for? e.g. Sales' : 'What was this spent on? e.g. Rent'}
            />
            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={busy || !category}
                onClick={() =>
                  act(async () => {
                    await recordBankLine(db, line.id, { accountId: category })
                    if (remember && keyword) await saveBankRule(db, company.id, { contains: keyword, direction: line.amount > 0 ? 'in' : 'out', accountId: category })
                  }, 'Recorded')
                }
              >
                Record
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => act(() => setBankLineIgnored(db, line.id, true), 'Ignored')}>
                Ignore
              </Button>
            </div>
          </div>
          {rule ? (
            <p className="text-xs text-fg-subtle">Suggested by your rule for “{rule.contains}”.</p>
          ) : (
            keyword && (
              <label className="flex items-center gap-2 text-xs text-fg-muted">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-[var(--primary)]" />
                Always use this category for “{keyword}”
              </label>
            )
          )}
        </div>
      )}
    </Card>
  )
}

function ImportDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const company = useCompany()
  const f = useFormat()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<string[][] | null>(null)
  const [hasHeader, setHasHeader] = useState(true)
  const [map, setMap] = useState<ColumnMap | null>(null)
  const [format, setFormat] = useState<DateFormat>('dmy')
  const [mode, setMode] = useState<'single' | 'split'>('single')
  const [error, setError] = useState<string | null>(null)

  const read = async (file: File) => {
    setError(null)
    const parsed = parseCsv(await file.text())
    if (parsed.length < 2) return setError('That file has no rows to import. Choose a CSV statement.')
    const guess = guessColumns(parsed[0])
    const header = guess.date >= 0 || guess.description >= 0
    setHasHeader(header)
    setMap(guess.date < 0 ? { ...guess, date: 0 } : guess)
    setMode(guess.amount < 0 && (guess.debit >= 0 || guess.credit >= 0) ? 'split' : 'single')
    const dateCol = guess.date >= 0 ? guess.date : 0
    setFormat(guessDateFormat(parsed.slice(header ? 1 : 0, 50).map((r) => r[dateCol] ?? ''), company.locale === 'en-US' ? 'mdy' : 'dmy'))
    setRows(parsed)
  }

  const body = rows ? rows.slice(hasHeader ? 1 : 0) : []
  const effective: ColumnMap | null = map ? (mode === 'single' ? { ...map, debit: -1, credit: -1 } : { ...map, amount: -1 }) : null
  const mapped = effective ? mapRows(body, effective, format, f.digits) : { rows: [], skipped: 0 }
  const columns = rows ? rows[0].map((h, i) => ({ value: i, label: hasHeader ? h || `Column ${i + 1}` : `Column ${i + 1} (${h.slice(0, 20)})` })) : []
  const colSelect = (label: string, key: keyof ColumnMap, optional = false) => (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={effective?.[key] ?? -1} onChange={(e) => setMap((m) => (m ? { ...m, [key]: Number(e.target.value) } : m))}>
          {optional && <option value={-1}>None</option>}
          {columns.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  )

  const doImport = async () => {
    try {
      const result = await importStatement(db, company.id, account.id, mapped.rows)
      toast(`Imported ${result.added} line${result.added === 1 ? '' : 's'}${result.duplicates ? ` · skipped ${result.duplicates} already imported` : ''}`)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`Import statement into ${account.name}`}
      description="Download your statement from online banking as a CSV file. Ledgerly reads most bank formats."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={doImport} disabled={!mapped.rows.length}>
            Import {mapped.rows.length || ''} lines
          </Button>
        </>
      }
    >
      {!rows ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line-strong px-6 py-10 text-center hover:border-primary hover:bg-primary-soft/40"
        >
          <Upload className="size-6 text-primary-ink" />
          <span className="font-medium">Choose a CSV file</span>
          <span className="text-xs text-fg-subtle">Columns like Date, Description and Amount (or Debit and Credit)</span>
        </button>
      ) : (
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} className="accent-[var(--primary)]" />
            The first row has column names
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {colSelect('Date column', 'date')}
            {colSelect('Description column', 'description')}
            <Field label="Date style">
              {(id) => (
                <Select id={id} value={format} onChange={(e) => setFormat(e.target.value as DateFormat)}>
                  <option value="dmy">Day / month / year</option>
                  <option value="mdy">Month / day / year</option>
                  <option value="ymd">Year-month-day</option>
                </Select>
              )}
            </Field>
          </div>
          <Segmented
            label="Amount layout"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'single', label: 'One amount column (+/−)' },
              { value: 'split', label: 'Separate in and out columns' },
            ]}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {mode === 'single' ? colSelect('Amount column', 'amount') : (
              <>
                {colSelect('Money in (credit) column', 'credit', true)}
                {colSelect('Money out (debit) column', 'debit', true)}
              </>
            )}
          </div>
          <div className="rounded-xl border border-line">
            <p className="border-b border-line px-3 py-2 text-xs font-medium text-fg-subtle">
              Preview · {mapped.rows.length} lines{mapped.skipped ? ` · ${mapped.skipped} rows skipped (no date or amount)` : ''}
            </p>
            <ul className="divide-y divide-line text-sm">
              {mapped.rows.slice(0, 5).map((r, i) => (
                <li key={i} className="flex gap-3 px-3 py-2">
                  <span className="w-24 shrink-0 text-fg-subtle">{f.date(r.date)}</span>
                  <span className="min-w-0 flex-1 truncate">{r.description}</span>
                  <span className={cn('tabular-nums', r.amount > 0 && 'text-success')}>{f.money(r.amount)}</span>
                </li>
              ))}
              {!mapped.rows.length && <li className="px-3 py-4 text-center text-fg-subtle">Choose the right columns to see the lines.</li>}
            </ul>
          </div>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void read(file)
        }}
      />
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Dialog>
  )
}

// ---------- Reconcile ----------

export function BankReconcile() {
  const company = useCompany()
  const f = useFormat()
  const toast = useToast()
  const { money } = useMoneyAccounts()
  const [account, choose] = useChosenAccount(money)
  const data = useLiveQuery(async () => {
    if (!account) return null
    const [lines, recs, bankLines] = await Promise.all([
      db.journalLines.where('[accountId+date]').between([account.id, ''], [account.id, '￿']).toArray(),
      db.reconciliations.where('accountId').equals(account.id).toArray(),
      db.bankLines.where('[accountId+date]').between([account.id, ''], [account.id, '￿']).toArray(),
    ])
    const entries = await db.journalEntries.bulkGet([...new Set(lines.map((l) => l.entryId))])
    return { lines, recs, bankLines, entries: new Map(entries.filter((e): e is JournalEntry => !!e).map((e) => [e.id, e])) }
  }, [account?.id])
  const [draft, setDraft] = useState<{ accountId: string; statementDate: string; statementBalance: number; cleared: Set<string> } | null>(null)

  const current = useMemo(() => {
    if (!data || !account) return null
    const open = data.recs.find((r) => r.status === 'in_progress')
    if (draft && draft.accountId === account.id) return draft
    const statementMatched = new Set(data.bankLines.map((b) => b.journalLineId).filter((x): x is string => !!x))
    return {
      accountId: account.id,
      statementDate: open?.statementDate ?? today(),
      statementBalance: open?.statementBalance ?? 0,
      cleared: new Set(open?.clearedLineIds ?? [...statementMatched]),
    }
  }, [data, account, draft])

  if (!money || data === undefined || current === undefined) return <Spinner />
  if (!account || !data || !current) return <Card><EmptyState title="No bank accounts" description="Add a bank or cash account first." /></Card>

  const done = reconciledLineIds(data.recs)
  const opening = openingReconciledBalance(data.recs)
  const candidates = data.lines.filter((l) => !done.has(l.id) && l.date <= current.statementDate).sort((a, b) => a.date.localeCompare(b.date))
  const clearedTotal = candidates.filter((l) => current.cleared.has(l.id)).reduce((s, l) => s + naturalAmount(account, l), 0)
  const difference = current.statementBalance - (opening + clearedTotal)
  const update = (patch: Partial<typeof current>) => setDraft({ ...current, ...patch })
  const toggle = (id: string) => {
    const next = new Set(current.cleared)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    update({ cleared: next })
  }
  const inProgress = data.recs.find((r) => r.status === 'in_progress')
  const history = data.recs.filter((r) => r.status === 'completed').sort((a, b) => b.statementDate.localeCompare(a.statementDate))

  const persist = async (finish: boolean) => {
    try {
      const rec = await saveReconciliation(db, company.id, {
        id: inProgress?.id,
        accountId: account.id,
        statementDate: current.statementDate,
        statementBalance: current.statementBalance,
        clearedLineIds: candidates.filter((l) => current.cleared.has(l.id)).map((l) => l.id),
      })
      if (finish) await completeReconciliation(db, rec.id)
      setDraft(null)
      toast(finish ? `${account.name} reconciled to ${f.date(current.statementDate)}` : 'Saved. You can finish later.')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <AccountSelect money={money} value={account.id} onChange={(id) => (setDraft(null), choose(id))} />
        <Field label="Statement end date" className="sm:w-48">
          {(id) => <Input id={id} type="date" value={current.statementDate} onChange={(e) => e.target.value && update({ statementDate: e.target.value })} />}
        </Field>
        <Field label="Closing balance on statement" className="sm:w-56">
          {(id) => <AmountInput id={id} allowNegative value={current.statementBalance} onChange={(v) => update({ statementBalance: v })} />}
        </Field>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Last reconciled balance', value: opening },
          { label: 'Ticked this time', value: clearedTotal },
          { label: 'Statement balance', value: current.statementBalance },
          { label: 'Difference', value: difference, highlight: true },
        ].map((s) => (
          <div key={s.label} className={cn('rounded-2xl border bg-surface px-4 py-3 shadow-card', s.highlight ? (difference === 0 ? 'border-success/40' : 'border-warning/50') : 'border-line')}>
            <p className="text-xs text-fg-subtle">{s.label}</p>
            <p className={cn('mt-0.5 text-lg font-semibold tabular-nums', s.highlight && (difference === 0 ? 'text-success' : 'text-warning'))}>{f.money(s.value)}</p>
          </div>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
          <p className="text-sm text-fg-muted">Tick every transaction that appears on your statement.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => update({ cleared: new Set(candidates.map((l) => l.id)) })}>
              Tick all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => update({ cleared: new Set() })}>
              Clear
            </Button>
          </div>
        </div>
        {candidates.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-fg-subtle">No unreconciled transactions up to this date.</p>
        ) : (
          <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto">
            {candidates.map((l) => {
              const amount = naturalAmount(account, l)
              return (
                <li key={l.id}>
                  <label className="flex cursor-pointer items-center gap-4 px-5 py-2.5 hover:bg-surface-2/60">
                    <input type="checkbox" checked={current.cleared.has(l.id)} onChange={() => toggle(l.id)} className="size-4 accent-[var(--primary)]" />
                    <span className="w-20 shrink-0 text-xs text-fg-subtle sm:w-24">{f.date(l.date)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{data.entries.get(l.entryId)?.memo || 'Transaction'}</span>
                    <span className={cn('w-28 text-right text-sm tabular-nums', amount > 0 && 'text-success')}>{f.money(amount)}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
        <div className="flex flex-col gap-2 border-t border-line bg-surface-2/50 px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
          {difference !== 0 && <p className="text-sm text-fg-muted sm:mr-auto">The difference must be zero to finish.</p>}
          <Button onClick={() => void persist(false)}>Save for later</Button>
          <Button variant="primary" icon={<Check />} disabled={difference !== 0} onClick={() => void persist(true)}>
            Finish reconciliation
          </Button>
        </div>
      </Card>

      {history.length > 0 && (
        <Card className="mt-4 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Past reconciliations</h2>
            <Button size="sm" variant="ghost" icon={<Undo2 />} onClick={() => void undoReconciliation(db, account.id).then(() => toast('Last reconciliation reopened'), (err) => toast(errorMessage(err), 'error'))}>
              Undo last
            </Button>
          </div>
          <ul className="divide-y divide-line">
            {history.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span>{f.date(r.statementDate)}</span>
                <span className="text-fg-muted">{r.clearedLineIds.length} transactions</span>
                <span className="font-medium tabular-nums">{f.money(r.statementBalance)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

// ---------- Rules ----------

export function BankRules() {
  const company = useCompany()
  const { accounts } = useMoneyAccounts()
  const rules = useLiveQuery(() => db.bankRules.where('companyId').equals(company.id).toArray(), [company.id])
  const [editing, setEditing] = useState<BankRule | 'new' | null>(null)
  if (!rules || !accounts) return <Spinner />
  const names = new Map(accounts.map((a) => [a.id, a.name]))

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <p className="text-sm text-fg-muted">Rules suggest a category for statement lines whose description contains a word.</p>
        <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')} className="ml-auto shrink-0">
          New rule
        </Button>
      </div>
      <Card className="overflow-hidden">
        {rules.length === 0 ? (
          <EmptyState icon={<WandSparkles />} title="No rules yet" description='For example: lines containing "UBER" are Travel. You can also create a rule while reviewing a statement.' />
        ) : (
          <ul className="divide-y divide-line">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  Contains <strong className="font-semibold">“{r.contains}”</strong> {r.direction !== 'any' && <span className="text-fg-subtle">· money {r.direction}</span>}
                  <span className="block text-xs text-fg-subtle">→ {names.get(r.accountId) ?? 'Missing account'}</span>
                </span>
                <Button size="icon" variant="ghost" aria-label="Edit rule" onClick={() => setEditing(r)}>
                  <Pencil />
                </Button>
                <Button size="icon" variant="ghost" aria-label="Delete rule" onClick={() => void deleteBankRule(db, r.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <RuleDialog rule={editing === 'new' ? undefined : editing} accounts={accounts} onClose={() => setEditing(null)} />}
    </div>
  )
}

function RuleDialog({ rule, accounts, onClose }: { rule?: BankRule; accounts: Account[]; onClose: () => void }) {
  const company = useCompany()
  const { mode } = usePrefs()
  const [contains, setContains] = useState(rule?.contains ?? '')
  const [direction, setDirection] = useState<BankRule['direction']>(rule?.direction ?? 'any')
  const [accountId, setAccountId] = useState(rule?.accountId ?? '')
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    try {
      await saveBankRule(db, company.id, { contains, direction, accountId }, rule?.id)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={rule ? 'Edit rule' : 'New rule'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save rule
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="When the description contains">{(id) => <Input id={id} value={contains} onChange={(e) => setContains(e.target.value)} placeholder="e.g. UBER" data-autofocus maxLength={60} />}</Field>
        <Segmented
          label="Direction"
          value={direction}
          onChange={setDirection}
          className="w-full [&>button]:flex-1"
          options={[
            { value: 'any', label: 'Money in or out' },
            { value: 'in', label: 'Money in' },
            { value: 'out', label: 'Money out' },
          ]}
        />
        <Field label="Suggest this category">
          {(id) => <AccountPicker id={id} accounts={accounts.filter((a) => !MONEY.has(a.subtype))} value={accountId} onChange={setAccountId} showCodes={mode === 'accountant'} groupOrder={['expense', 'income', 'asset', 'liability', 'equity']} />}
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  )
}
