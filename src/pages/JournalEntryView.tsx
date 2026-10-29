import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Copy, Printer, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { reverseEntry } from '../accounting/engine'
import { errorMessage } from '../accounting/errors'
import { Button, LinkButton } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'
import { Field, Input } from '../components/ui/form'
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../components/ui/misc'
import { useToast } from '../components/ui/toast'
import { db } from '../db'
import { today } from '../lib/dates'
import { useCompany, useFormat } from '../state/company'
import { useAccounts } from '../state/data'
import { usePrefs } from '../state/prefs'

export function JournalEntryView() {
  const { id = '' } = useParams()
  const company = useCompany()
  const f = useFormat()
  const { mode } = usePrefs()
  const accounts = useAccounts(company.id)
  const [reversing, setReversing] = useState(false)

  const data = useLiveQuery(async () => {
    const entry = await db.journalEntries.get(id)
    if (!entry) return null
    const lines = await db.journalLines.where('entryId').equals(id).sortBy('order')
    const related = await db.journalEntries.bulkGet([entry.reversalOfId, entry.reversedById].filter((x): x is string => !!x))
    const audit = await db.audit.where('[companyId+at]').between([entry.companyId, 0], [entry.companyId, Infinity]).filter((a) => a.entityId === id).toArray()
    return { entry, lines, related: related.filter((r) => !!r), audit }
  }, [id])

  if (data === undefined || !accounts) return <Spinner />
  if (data === null || data.entry.companyId !== company.id) {
    return (
      <Card>
        <EmptyState title="Transaction not found" action={<Link to="/journal" className="text-sm font-medium text-primary-ink">Back to transactions</Link>} />
      </Card>
    )
  }

  const { entry, lines, related, audit } = data
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const original = related.find((r) => r!.id === entry.reversalOfId)
  const reversal = related.find((r) => r!.id === entry.reversedById)
  const canReverse = entry.status === 'posted' && entry.source !== 'reversal'

  return (
    <div>
      <PageHeader
        back={
          <Link to="/journal" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> {mode === 'simple' ? 'Transactions' : 'Journal'}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {entry.memo || (entry.source === 'opening' ? 'Opening balances' : 'Journal entry')}
            {entry.status === 'reversed' && <Badge tone="warning">Reversed</Badge>}
            {entry.source === 'reversal' && <Badge>Reversal</Badge>}
          </span>
        }
        description={`${entry.number} · ${f.date(entry.date)}${entry.reference ? ` · Ref ${entry.reference}` : ''}`}
        actions={
          <>
            <Button icon={<Printer />} onClick={() => window.print()}>
              Print
            </Button>
            {entry.source === 'manual' && (
              <LinkButton to={`/journal/new?copy=${entry.id}`} icon={<Copy />}>
                Copy
              </LinkButton>
            )}
            {canReverse && entry.source !== 'opening' && (
              <Button icon={<Undo2 />} onClick={() => setReversing(true)}>
                Reverse
              </Button>
            )}
          </>
        }
      />

      {(original || reversal) && (
        <div className="mb-4 rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-sm text-fg-muted">
          {original && (
            <>
              This entry cancels{' '}
              <Link to={`/journal/${original.id}`} className="font-medium text-primary-ink hover:underline">
                {original.number}
              </Link>
              .
            </>
          )}
          {reversal && (
            <>
              This entry was cancelled by{' '}
              <Link to={`/journal/${reversal.id}`} className="font-medium text-primary-ink hover:underline">
                {reversal.number}
              </Link>{' '}
              on {f.date(reversal.date)}. Both stay in your books so the history is complete.
            </>
          )}
        </div>
      )}
      {entry.source === 'opening' && entry.status === 'posted' && (
        <div className="mb-4 rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-sm text-fg-muted">
          To change opening balances, use the{' '}
          <Link to="/accounts/opening-balances" className="font-medium text-primary-ink hover:underline">
            opening balances page
          </Link>
          .
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-fg-subtle">
                <th className="px-5 py-2.5 font-medium">Account</th>
                <th className="px-3 py-2.5 font-medium">Note</th>
                <th className="px-3 py-2.5 text-right font-medium">Debit</th>
                <th className="px-5 py-2.5 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {lines.map((l) => {
                const account = byId.get(l.accountId)
                return (
                  <tr key={l.id} className="border-b border-line">
                    <td className="px-5 py-3">
                      <Link to={`/accounts/${l.accountId}`} className="font-medium text-fg hover:text-primary-ink">
                        {mode === 'accountant' && <span className="mr-2 text-fg-subtle">{account?.code}</span>}
                        {account?.name ?? 'Unknown account'}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-fg-muted">{l.description}</td>
                    <td className="px-3 py-3 text-right">{l.debit ? f.money(l.debit) : ''}</td>
                    <td className="px-5 py-3 text-right">{l.credit ? f.money(l.credit) : ''}</td>
                  </tr>
                )
              })}
              <tr className="bg-surface-2/50 font-semibold">
                <td className="px-5 py-3" colSpan={2}>
                  Total
                </td>
                <td className="px-3 py-3 text-right">{f.money(entry.total)}</td>
                <td className="px-5 py-3 text-right">{f.money(entry.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {audit.length > 0 && (
        <div className="mt-6 no-print">
          <h2 className="mb-2 text-sm font-semibold">History</h2>
          <ul className="space-y-1.5 text-sm text-fg-muted">
            {audit.map((a) => (
              <li key={a.id}>
                {new Date(a.at).toLocaleString(company.locale, { dateStyle: 'medium', timeStyle: 'short' })} · {a.summary}
              </li>
            ))}
          </ul>
        </div>
      )}

      {reversing && <ReverseDialog entryId={entry.id} entryDate={entry.date} number={entry.number} onClose={() => setReversing(false)} />}
    </div>
  )
}

function ReverseDialog({ entryId, entryDate, number, onClose }: { entryId: string; entryDate: string; number: string; onClose: () => void }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [date, setDate] = useState(today() < entryDate ? entryDate : today())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      const reversal = await reverseEntry(db, entryId, date)
      toast(`Reversed with ${reversal.number}`)
      onClose()
      navigate(`/journal/${reversal.id}`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Reverse ${number}?`}
      description="This posts an equal and opposite entry, which cancels the original. Nothing is deleted."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={confirm} disabled={busy}>
            Reverse entry
          </Button>
        </>
      }
    >
      <Field label="Reversal date" error={error}>
        {(id, d) => <Input id={id} aria-describedby={d} type="date" value={date} min={entryDate} onChange={(e) => setDate(e.target.value)} />}
      </Field>
    </Dialog>
  )
}
