import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, ArchiveRestore, ArrowLeft, Download, Lock, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { deleteAccount, setAccountArchived, subtypeInfo, TYPE_LABELS } from '../accounting/accounts'
import { isDebitNormal } from '../accounting/engine'
import { errorMessage } from '../accounting/errors'
import { computeLedger, MIN_DATE } from '../accounting/reports'
import { AccountDialog } from '../components/AccountDialog'
import { DateRangeControl, useDateRange } from '../components/DateRange'
import { Button } from '../components/ui/button'
import { ConfirmDialog } from '../components/ui/dialog'
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../components/ui/misc'
import { useToast } from '../components/ui/toast'
import { db } from '../db'
import type { JournalEntry, JournalLine } from '../db/types'
import { cn } from '../lib/cn'
import { addDays } from '../lib/dates'
import { downloadFile, toCSV } from '../lib/platform'
import { useCompany, useFormat } from '../state/company'
import { useAccounts } from '../state/data'
import { usePrefs } from '../state/prefs'

export function AccountDetail() {
  const { id = '' } = useParams()
  const company = useCompany()
  const f = useFormat()
  const { mode } = usePrefs()
  const toast = useToast()
  const navigate = useNavigate()
  const [range, setRange] = useDateRange('this_fy')
  const accounts = useAccounts(company.id)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const data = useLiveQuery(async () => {
    const lines = await db.journalLines.where('[accountId+date]').between([id, MIN_DATE], [id, range.to], true, true).toArray()
    const before = lines.filter((l) => l.date < range.from)
    const within = lines.filter((l) => l.date >= range.from)
    const entries = await db.journalEntries.bulkGet([...new Set(within.map((l) => l.entryId))])
    return { before, within, entries: new Map(entries.filter((e): e is JournalEntry => !!e).map((e) => [e.id, e])) }
  }, [id, range.from, range.to])

  const account = accounts?.find((a) => a.id === id)

  const ledger = useMemo(() => {
    if (!account || !data) return null
    const sign = (l: JournalLine) => (isDebitNormal(account.type) ? l.debit - l.credit : l.credit - l.debit)
    const opening = data.before.reduce((s, l) => s + sign(l), 0)
    const rows = computeLedger(account, opening, data.within, data.entries)
    const increase = data.within.reduce((s, l) => s + Math.max(0, sign(l)), 0)
    const decrease = data.within.reduce((s, l) => s + Math.max(0, -sign(l)), 0)
    return { opening, rows, closing: rows.length ? rows[rows.length - 1].balance : opening, increase, decrease }
  }, [account, data])

  if (!accounts || !data) return <Spinner />
  if (!account) {
    return (
      <Card>
        <EmptyState title="Account not found" description="It may have been deleted." action={<Link to="/accounts" className="text-sm font-medium text-primary-ink">Back to accounts</Link>} />
      </Card>
    )
  }
  if (!ledger) return <Spinner />

  const simple = mode === 'simple'
  const isMoney = account.subtype === 'cash' || account.subtype === 'bank'
  const incLabel = simple ? (isMoney ? 'Money in' : 'Increase') : 'Debit'
  const decLabel = simple ? (isMoney ? 'Money out' : 'Decrease') : 'Credit'
  // In accountant mode columns are always debit/credit; in simple mode they follow the account's normal direction.
  const colA = (l: JournalLine) => (simple ? (isDebitNormal(account.type) ? l.debit : l.credit) : l.debit)
  const colB = (l: JournalLine) => (simple ? (isDebitNormal(account.type) ? l.credit : l.debit) : l.credit)

  const toggleArchive = async () => {
    try {
      await setAccountArchived(db, account.id, !account.archived)
      toast(account.archived ? 'Account restored' : 'Account archived. It is hidden from pickers but keeps its history.')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }
  const remove = async () => {
    try {
      await deleteAccount(db, account.id)
      toast('Account deleted')
      navigate('/accounts', { replace: true })
    } catch (err) {
      setConfirmDelete(false)
      toast(errorMessage(err), 'error')
    }
  }
  const exportCsv = () => {
    const rows: (string | number)[][] = [['Date', 'Number', 'Description', incLabel, decLabel, 'Balance']]
    rows.push([addDays(range.from, -1), '', 'Opening balance', '', '', f.toInput(ledger.opening) || '0'])
    for (const r of ledger.rows) {
      rows.push([r.line.date, r.entry?.number ?? '', r.line.description || r.entry?.memo || '', f.toInput(colA(r.line)), f.toInput(colB(r.line)), f.toInput(r.balance) || '0'])
    }
    downloadFile(`${account.name} ${range.from} to ${range.to}.csv`, toCSV(rows), 'text/csv')
  }

  return (
    <div>
      <PageHeader
        back={
          <Link to="/accounts" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> {simple ? 'Accounts' : 'Chart of accounts'}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {!simple && <span className="text-fg-subtle tabular-nums">{account.code}</span>}
            {account.name}
            {account.archived && <Badge>Archived</Badge>}
            {account.systemKey && (
              <Badge tone="primary">
                <Lock /> Used by the app
              </Badge>
            )}
          </span>
        }
        description={account.description || `${TYPE_LABELS[account.type]} · ${subtypeInfo(account.subtype).label}`}
        actions={
          <>
            <Button icon={<Pencil />} onClick={() => setEditing(true)}>
              Edit
            </Button>
            {!account.systemKey && (
              <Button icon={account.archived ? <ArchiveRestore /> : <Archive />} onClick={toggleArchive}>
                {account.archived ? 'Restore' : 'Archive'}
              </Button>
            )}
            {!account.systemKey && (
              <Button variant="ghost" icon={<Trash2 />} onClick={() => setConfirmDelete(true)} aria-label="Delete account" />
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="Opening balance" value={f.money(ledger.opening)} />
        <Figure label={simple ? incLabel : 'Increases'} value={f.money(ledger.increase)} />
        <Figure label={simple ? decLabel : 'Decreases'} value={f.money(ledger.decrease)} />
        <Figure label="Closing balance" value={f.money(ledger.closing)} strong />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <DateRangeControl range={range} onChange={setRange} />
          <Button size="sm" variant="ghost" icon={<Download />} onClick={exportCsv}>
            Export CSV
          </Button>
        </div>
        {ledger.rows.length === 0 ? (
          <EmptyState title="No transactions in this period" description="Choose a different period, or record a transaction for this account." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-fg-subtle">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Description</th>
                  <th className="px-3 py-2.5 text-right font-medium">{incLabel}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{decLabel}</th>
                  <th className="px-5 py-2.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-b border-line bg-surface-2/40 text-fg-muted">
                  <td className="px-5 py-2.5">{f.date(range.from)}</td>
                  <td className="px-3 py-2.5" colSpan={3}>
                    Opening balance
                  </td>
                  <td className="px-5 py-2.5 text-right">{f.money(ledger.opening)}</td>
                </tr>
                {ledger.rows.map((r) => (
                  <tr key={r.line.id} className="border-b border-line last:border-0 hover:bg-surface-2/50">
                    <td className="px-5 py-2.5 whitespace-nowrap text-fg-muted">{f.date(r.line.date)}</td>
                    <td className="max-w-80 px-3 py-2.5">
                      <Link to={`/journal/${r.line.entryId}`} className="block truncate text-fg hover:text-primary-ink">
                        {r.line.description || r.entry?.memo || 'Journal entry'}
                      </Link>
                      <span className="text-xs text-fg-subtle">{r.entry?.number}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">{colA(r.line) ? f.money(colA(r.line)) : ''}</td>
                    <td className="px-3 py-2.5 text-right">{colB(r.line) ? f.money(colB(r.line)) : ''}</td>
                    <td className={cn('px-5 py-2.5 text-right font-medium', r.balance < 0 && 'text-danger')}>{f.money(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AccountDialog open={editing} onClose={() => setEditing(false)} accounts={accounts} account={account} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        danger
        title={`Delete ${account.name}?`}
        description="Only accounts with no transactions can be deleted. This can't be undone."
        confirmLabel="Delete account"
      />
    </div>
  )
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('rounded-2xl border border-line bg-surface p-4 shadow-card', strong && 'ring-1 ring-primary/20')}>
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold text-fg">{value}</p>
    </div>
  )
}
