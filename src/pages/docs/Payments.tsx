import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Ban, Banknote, Pencil, Plus, Search, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { DOC_TYPES, docState } from '../../accounting/documents'
import { errorMessage } from '../../accounting/errors'
import { autoAllocate, savePayment, voidPayment } from '../../accounting/payments'
import { AccountPicker } from '../../components/AccountPicker'
import { AmountInput } from '../../components/AmountInput'
import { ContactPicker } from '../../components/ContactPicker'
import { Button, LinkButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { Field, Input, Textarea } from '../../components/ui/form'
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../../components/ui/misc'
import { useToast } from '../../components/ui/toast'
import { db } from '../../db'
import { today } from '../../lib/dates'
import { useCompany, useFormat } from '../../state/company'
import { useAccounts, useContacts, useLedgerDocs } from '../../state/data'
import { usePrefs } from '../../state/prefs'

type Direction = 'in' | 'out'
const base = (d: Direction) => (d === 'in' ? '/sales/payments' : '/purchases/payments')
const MONEY = new Set(['cash', 'bank', 'credit_card'])

export function PaymentList({ direction }: { direction: Direction }) {
  const company = useCompany()
  const f = useFormat()
  const { payments } = useLedgerDocs(company.id)
  const contacts = useContacts(company.id)
  const accounts = useAccounts(company.id)
  const [query, setQuery] = useState('')
  if (!payments || !contacts || !accounts) return <Spinner />
  const names = new Map(contacts.map((c) => [c.id, c.name]))
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]))
  const q = query.trim().toLowerCase()
  const rows = payments
    .filter((p) => p.direction === direction)
    .filter((p) => !q || p.number.toLowerCase().includes(q) || names.get(p.contactId)?.toLowerCase().includes(q) || p.reference?.toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search payments" aria-label="Search payments" className="pl-9" />
        </div>
        <LinkButton to={`${base(direction)}/new`} variant="primary" icon={<Plus />} className="ml-auto">
          {direction === 'in' ? 'Receive payment' : 'Pay a supplier'}
        </LinkButton>
      </div>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Banknote />}
            title={direction === 'in' ? 'No payments received yet' : 'No payments made yet'}
            description={direction === 'in' ? 'When a customer pays, record it here to mark their invoices as paid.' : 'Record what you pay suppliers to mark their bills as paid.'}
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((p) => {
              const unapplied = p.amount - p.allocations.reduce((s, a) => s + a.amount, 0)
              return (
                <li key={p.id}>
                  <Link to={`${base(direction)}/${p.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-surface-2/60">
                    <span className="w-24 shrink-0 text-xs text-fg-subtle">{f.date(p.date)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{names.get(p.contactId) ?? 'Unknown'}</span>
                      <span className="block truncate text-xs text-fg-subtle">
                        {p.number} · {accountNames.get(p.accountId)}
                      </span>
                    </span>
                    {p.status === 'void' ? <Badge>Void</Badge> : unapplied > 0 ? <Badge tone="warning">{f.money(unapplied)} unapplied</Badge> : null}
                    <span className="text-sm font-semibold tabular-nums">{f.money(p.amount)}</span>
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

export function PaymentForm({ direction }: { direction: Direction }) {
  const { id } = useParams()
  const [params] = useSearchParams()
  const company = useCompany()
  const f = useFormat()
  const { mode } = usePrefs()
  const toast = useToast()
  const navigate = useNavigate()
  const accounts = useAccounts(company.id)
  const { docs, settled } = useLedgerDocs(company.id)
  const existing = useLiveQuery(async () => (id ? ((await db.payments.get(id)) ?? null) : null), [id])
  const [contactId, setContactId] = useState('')
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState(0)
  const [accountId, setAccountId] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [allocs, setAllocs] = useState<Record<string, number>>({})
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const targetType = direction === 'in' ? 'invoice' : 'bill'

  useEffect(() => {
    if (ready || !accounts || !docs || !settled || existing === undefined) return
    if (existing) {
      setContactId(existing.contactId)
      setDate(existing.date)
      setAmount(existing.amount)
      setAccountId(existing.accountId)
      setReference(existing.reference ?? '')
      setNotes(existing.notes ?? '')
      setAllocs(Object.fromEntries(existing.allocations.map((a) => [a.documentId, a.amount])))
    } else {
      setAccountId(accounts.find((a) => a.systemKey === 'bank')?.id ?? '')
      const doc = docs.find((d) => d.id === params.get('doc'))
      const contact = doc?.contactId ?? params.get('contact')
      if (contact) setContactId(contact)
      if (doc) {
        const due = doc.total - (settled.get(doc.id) ?? 0)
        setAmount(due)
        setAllocs({ [doc.id]: due })
      }
    }
    setReady(true)
  }, [ready, accounts, docs, settled, existing, params])

  const open = useMemo(() => {
    if (!docs || !settled || !contactId) return []
    const mine = new Map(existing ? existing.allocations.map((a) => [a.documentId, a.amount]) : [])
    return docs
      .filter((d) => d.type === targetType && d.status === 'posted' && d.contactId === contactId)
      .map((d) => ({ doc: d, due: d.total - (settled.get(d.id) ?? 0) + (mine.get(d.id) ?? 0) }))
      .filter((x) => x.due > 0 || mine.has(x.doc.id))
      .sort((a, b) => (a.doc.dueDate ?? a.doc.date).localeCompare(b.doc.dueDate ?? b.doc.date))
  }, [docs, settled, contactId, targetType, existing])

  if (!ready || !accounts) return <Spinner />
  if (existing?.status === 'void') return <Card className="p-6 text-sm text-fg-muted">This payment is void and can't be edited.</Card>

  const applied = Object.entries(allocs).filter(([docId]) => open.some((o) => o.doc.id === docId)).reduce((s, [, v]) => s + v, 0)
  const unapplied = amount - applied

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const payment = await savePayment(
        db,
        company.id,
        {
          direction,
          contactId,
          date,
          amount,
          accountId,
          reference,
          notes,
          allocations: open.map((o) => ({ documentId: o.doc.id, amount: allocs[o.doc.id] ?? 0 })),
        },
        existing?.id,
      )
      toast(`Payment ${payment.number} saved`)
      navigate(`${base(direction)}/${payment.id}`, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const label = direction === 'in' ? 'customer' : 'supplier'
  return (
    <div>
      <PageHeader
        back={
          <Link to={base(direction)} className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> Payments
          </Link>
        }
        title={existing ? `Edit payment ${existing.number}` : direction === 'in' ? 'Receive a payment' : 'Pay a supplier'}
        description={direction === 'in' ? 'Record money a customer paid you and choose which invoices it covers.' : 'Record money you paid a supplier and choose which bills it covers.'}
      />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Card className="p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={direction === 'in' ? 'Customer' : 'Supplier'} className="sm:col-span-2">
              {(fid) => (
                <ContactPicker
                  id={fid}
                  type={direction === 'in' ? 'customer' : 'supplier'}
                  value={contactId}
                  onChange={(v) => {
                    setContactId(v)
                    setAllocs({})
                  }}
                />
              )}
            </Field>
            <Field label="Amount">{(fid) => <AmountInput id={fid} value={amount} onChange={setAmount} className="font-semibold" />}</Field>
            <Field label="Date">{(fid) => <Input id={fid} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
            <Field label={direction === 'in' ? 'Paid into' : 'Paid from'} className="sm:col-span-2">
              {(fid) => (
                <AccountPicker id={fid} accounts={accounts.filter((a) => MONEY.has(a.subtype))} value={accountId} onChange={setAccountId} showCodes={mode === 'accountant'} groupOrder={['asset', 'liability']} />
              )}
            </Field>
            <Field label="Reference" hint="Cheque, transfer or receipt number." className="sm:col-span-2">
              {(fid, d) => <Input id={fid} aria-describedby={d} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />}
            </Field>
          </div>
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Apply to {DOC_TYPES[targetType].plural.toLowerCase()}</h2>
            {open.length > 0 && (
              <Button
                size="sm"
                variant="soft"
                icon={<Wand2 />}
                onClick={() => {
                  const total = amount || open.reduce((s, o) => s + o.due, 0)
                  if (!amount) setAmount(total)
                  setAllocs(Object.fromEntries(autoAllocate(total, open.map((o) => ({ id: o.doc.id, due: o.due }))).map((a) => [a.documentId, a.amount])))
                }}
              >
                Apply oldest first
              </Button>
            )}
          </div>
          {!contactId ? (
            <p className="px-5 py-6 text-sm text-fg-subtle">Choose a {label} to see what they {direction === 'in' ? 'owe you' : "you owe them"}.</p>
          ) : open.length === 0 ? (
            <p className="px-5 py-6 text-sm text-fg-subtle">Nothing is outstanding. The payment will be kept as a credit for this {label}.</p>
          ) : (
            <ul className="divide-y divide-line">
              {open.map(({ doc, due }) => (
                <li key={doc.id} className="flex items-center gap-3 px-5 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Pay ${doc.number}`}
                    checked={(allocs[doc.id] ?? 0) > 0}
                    onChange={(e) => setAllocs((m) => ({ ...m, [doc.id]: e.target.checked ? Math.max(0, Math.min(due, unapplied > 0 ? unapplied : due)) : 0 }))}
                    className="size-4 accent-[var(--primary)]"
                  />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">
                      {doc.number} <span className="text-xs font-normal text-fg-subtle">{docState(doc, settled?.get(doc.id) ?? 0) === 'overdue' ? '· overdue' : ''}</span>
                    </p>
                    <p className="text-xs text-fg-subtle">
                      {f.date(doc.date)}
                      {doc.dueDate ? ` · due ${f.date(doc.dueDate)}` : ''} · {f.money(due)} left
                    </p>
                  </div>
                  <AmountInput value={allocs[doc.id] ?? 0} onChange={(v) => setAllocs((m) => ({ ...m, [doc.id]: Math.min(v, due) }))} className="w-32 sm:w-40" aria-label={`Amount for ${doc.number}`} />
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap justify-end gap-6 border-t border-line bg-surface-2/50 px-5 py-3 text-sm">
            <span className="text-fg-muted">
              Applied <strong className="text-fg tabular-nums">{f.money(applied)}</strong>
            </span>
            <span className={unapplied < 0 ? 'text-danger' : 'text-fg-muted'}>
              {unapplied < 0 ? 'Over by' : 'Left as credit'} <strong className="tabular-nums">{f.money(Math.abs(unapplied))}</strong>
            </span>
          </div>
        </Card>

        <Card className="p-5">
          <Field label="Notes">{(fid) => <Textarea id={fid} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />}</Field>
        </Card>

        {error && <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={() => navigate(-1)}>Cancel</Button>
          <Button variant="primary" size="lg" type="submit" disabled={busy || unapplied < 0}>
            Save payment
          </Button>
        </div>
      </form>
    </div>
  )
}

export function PaymentView({ direction }: { direction: Direction }) {
  const { id = '' } = useParams()
  const company = useCompany()
  const f = useFormat()
  const toast = useToast()
  const payment = useLiveQuery(async () => (await db.payments.get(id)) ?? null, [id])
  const contacts = useContacts(company.id)
  const accounts = useAccounts(company.id)
  const { docs } = useLedgerDocs(company.id)
  const [confirm, setConfirm] = useState(false)
  if (payment === undefined || !contacts || !accounts || !docs) return <Spinner />
  if (!payment || payment.companyId !== company.id) return <Card><EmptyState title="Payment not found" /></Card>
  const contact = contacts.find((c) => c.id === payment.contactId)
  const unapplied = payment.amount - payment.allocations.reduce((s, a) => s + a.amount, 0)

  return (
    <div>
      <PageHeader
        back={
          <Link to={base(direction)} className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> Payments
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {f.money(payment.amount)} {direction === 'in' ? 'from' : 'to'} {contact?.name}
            {payment.status === 'void' && <Badge>Void</Badge>}
          </span>
        }
        description={`${payment.number} · ${f.date(payment.date)} · ${direction === 'in' ? 'into' : 'from'} ${accounts.find((a) => a.id === payment.accountId)?.name ?? ''}${payment.reference ? ` · Ref ${payment.reference}` : ''}`}
        actions={
          payment.status === 'posted' && (
            <>
              <LinkButton to={`${base(direction)}/${payment.id}/edit`} icon={<Pencil />}>
                Edit
              </LinkButton>
              <Button icon={<Ban />} onClick={() => setConfirm(true)}>
                Void
              </Button>
            </>
          )
        }
      />
      <Card className="overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Applied to</h2>
        <ul className="divide-y divide-line">
          {payment.allocations.map((a) => {
            const d = docs.find((x) => x.id === a.documentId)
            return (
              <li key={a.documentId} className="flex items-center justify-between px-5 py-3 text-sm">
                {d ? (
                  <Link to={`${DOC_TYPES[d.type].path}/${d.id}`} className="font-medium text-fg hover:text-primary-ink">
                    {DOC_TYPES[d.type].label} {d.number}
                  </Link>
                ) : (
                  <span>Removed document</span>
                )}
                <span className="tabular-nums">{f.money(a.amount)}</span>
              </li>
            )
          })}
          {unapplied > 0 && (
            <li className="flex items-center justify-between px-5 py-3 text-sm text-fg-muted">
              Not applied (kept as credit)
              <span className="tabular-nums">{f.money(unapplied)}</span>
            </li>
          )}
        </ul>
      </Card>
      {payment.notes && <p className="mt-4 text-sm whitespace-pre-line text-fg-muted">{payment.notes}</p>}
      {payment.entryId && (
        <p className="mt-4 text-sm">
          <Link to={`/journal/${payment.entryId}`} className="text-primary-ink hover:underline">
            View the journal entry
          </Link>
        </p>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false)
          try {
            await voidPayment(db, payment.id)
            toast('Payment voided')
          } catch (err) {
            toast(errorMessage(err), 'error')
          }
        }}
        danger
        title="Void this payment?"
        description="It's cancelled in your books and the invoices or bills it paid become unpaid again."
        confirmLabel="Void payment"
      />
    </div>
  )
}
