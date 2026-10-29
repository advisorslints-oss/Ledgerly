import { Archive, ArchiveRestore, ArrowLeft, CreditCard, Mail, Pencil, Phone, Plus, Search, Trash2, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { deleteContact, isCustomer, isSupplier, setContactArchived } from '../../accounting/contacts'
import { DOC_TYPES, docState } from '../../accounting/documents'
import { errorMessage } from '../../accounting/errors'
import { ContactDialog } from '../../components/ContactDialog'
import { StateBadge } from '../../components/StateBadge'
import { Button, LinkButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { Input, Switch } from '../../components/ui/form'
import { Badge, Card, EmptyState, PageHeader, Segmented, Spinner } from '../../components/ui/misc'
import { useToast } from '../../components/ui/toast'
import { db } from '../../db'
import type { Contact, Doc, Payment } from '../../db/types'
import { cn } from '../../lib/cn'
import { fiscalYearStart, today } from '../../lib/dates'
import { useCompany, useFormat } from '../../state/company'
import { useContacts, useLedgerDocs } from '../../state/data'

type Kind = 'customer' | 'supplier'
const base = (k: Kind) => (k === 'customer' ? '/sales/customers' : '/purchases/suppliers')

/** What a contact owes you (customers) or you owe them (suppliers), and how much of it is overdue. */
function balanceFor(kind: Kind, contactId: string, docs: Doc[], payments: Payment[], settled: Map<string, number>) {
  const own = docs.filter((d) => d.contactId === contactId && d.status === 'posted')
  const target = kind === 'customer' ? 'invoice' : 'bill'
  const credit = kind === 'customer' ? 'credit_note' : 'supplier_credit'
  const charged = own.filter((d) => d.type === target).reduce((s, d) => s + d.total, 0)
  const credits = own.filter((d) => d.type === credit).reduce((s, d) => s + d.total, 0)
  const paid = payments.filter((p) => p.contactId === contactId && p.status === 'posted' && p.direction === (kind === 'customer' ? 'in' : 'out')).reduce((s, p) => s + p.amount, 0)
  const overdue = own.filter((d) => d.type === target && docState(d, settled.get(d.id) ?? 0) === 'overdue').reduce((s, d) => s + d.total - (settled.get(d.id) ?? 0), 0)
  return { balance: charged - credits - paid, overdue }
}

export function ContactList({ kind }: { kind: Kind }) {
  const company = useCompany()
  const f = useFormat()
  const navigate = useNavigate()
  const contacts = useContacts(company.id)
  const { docs, payments, settled } = useLedgerDocs(company.id)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)

  const rows = useMemo(() => {
    if (!contacts || !docs || !payments || !settled) return null
    return contacts
      .filter((c) => (kind === 'customer' ? isCustomer(c) : isSupplier(c)))
      .map((c) => ({ contact: c, ...balanceFor(kind, c.id, docs, payments, settled) }))
      .sort((a, b) => a.contact.name.localeCompare(b.contact.name))
  }, [contacts, docs, payments, settled, kind])

  if (!rows) return <Spinner />
  const q = query.trim().toLowerCase()
  const visible = rows.filter((r) => (showArchived || !r.contact.archived) && (!q || r.contact.name.toLowerCase().includes(q) || r.contact.email?.toLowerCase().includes(q) || r.contact.phone?.includes(q)))
  const totalBalance = rows.reduce((s, r) => s + r.balance, 0)
  const totalOverdue = rows.reduce((s, r) => s + r.overdue, 0)
  const noun = kind === 'customer' ? 'customer' : 'supplier'

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
          <p className="text-xs text-fg-subtle">{kind === 'customer' ? 'They owe you' : 'You owe them'}</p>
          <p className="mt-0.5 text-lg font-semibold">{f.money(totalBalance)}</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
          <p className="text-xs text-fg-subtle">Overdue</p>
          <p className={cn('mt-0.5 text-lg font-semibold', totalOverdue > 0 && 'text-danger')}>{f.money(totalOverdue)}</p>
        </div>
      </div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${noun}s`} aria-label={`Search ${noun}s`} className="pl-9" />
        </div>
        <Switch checked={showArchived} onChange={setShowArchived} label="Show archived" />
        <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)} className="sm:ml-auto">
          New {noun}
        </Button>
      </div>
      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={rows.length ? `No ${noun}s match` : `No ${noun}s yet`}
            description={rows.length ? 'Try a different search.' : `Add ${noun}s to send them ${kind === 'customer' ? 'invoices and quotes' : 'purchase orders and track their bills'}.`}
            action={!rows.length && <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>New {noun}</Button>}
          />
        ) : (
          <ul className="divide-y divide-line">
            {visible.map(({ contact, balance, overdue }) => (
              <li key={contact.id}>
                <Link to={`${base(kind)}/${contact.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-surface-2/60">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary-ink">{contact.name.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('flex items-center gap-2 text-sm font-medium', contact.archived && 'text-fg-subtle')}>
                      <span className="truncate">{contact.name}</span>
                      {contact.archived && <Badge>Archived</Badge>}
                    </span>
                    <span className="block truncate text-xs text-fg-subtle">{[contact.email, contact.phone].filter(Boolean).join(' · ') || 'No contact details'}</span>
                  </span>
                  {overdue > 0 && <Badge tone="danger">{f.money(overdue)} overdue</Badge>}
                  <span className={cn('text-sm tabular-nums', balance ? 'font-semibold text-fg' : 'text-fg-subtle')}>{f.money(balance)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ContactDialog open={creating} onClose={() => setCreating(false)} type={kind} onSaved={(c) => navigate(`${base(kind)}/${c.id}`)} />
    </div>
  )
}

export function ContactView({ kind }: { kind: Kind }) {
  const { id = '' } = useParams()
  const company = useCompany()
  const f = useFormat()
  const toast = useToast()
  const navigate = useNavigate()
  const contacts = useContacts(company.id)
  const { docs, payments, settled } = useLedgerDocs(company.id)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tab, setTab] = useState<'activity' | 'statement'>('activity')

  if (!contacts || !docs || !payments || !settled) return <Spinner />
  const contact = contacts.find((c) => c.id === id)
  if (!contact) return <Card><EmptyState title="Contact not found" action={<Link to={base(kind)} className="text-sm font-medium text-primary-ink">Back</Link>} /></Card>

  const { balance, overdue } = balanceFor(kind, contact.id, docs, payments, settled)
  const fyStart = fiscalYearStart(today(), company.fiscalYearStartMonth)
  const sideTypes = kind === 'customer' ? ['invoice', 'quote', 'credit_note'] : ['bill', 'purchase_order', 'supplier_credit', 'expense']
  const mine = docs.filter((d) => d.contactId === contact.id && sideTypes.includes(d.type))
  const myPayments = payments.filter((p) => p.contactId === contact.id && p.direction === (kind === 'customer' ? 'in' : 'out'))
  const yearTotal = mine.filter((d) => d.status === 'posted' && d.date >= fyStart && (d.type === 'invoice' || d.type === 'bill' || d.type === 'expense')).reduce((s, d) => s + d.subtotal, 0)

  const activity = [
    ...mine.map((d) => ({ key: d.id, date: d.date, title: `${DOC_TYPES[d.type].label} ${d.number}`, to: `${DOC_TYPES[d.type].path}/${d.id}`, amount: d.total, state: docState(d, settled.get(d.id) ?? 0) })),
    ...myPayments.map((p) => ({ key: p.id, date: p.date, title: `Payment ${p.number}`, to: `${kind === 'customer' ? '/sales' : '/purchases'}/payments/${p.id}`, amount: p.amount, state: p.status === 'void' ? 'void' : 'paid' })),
  ].sort((a, b) => b.date.localeCompare(a.date))

  const statement = (() => {
    const events = [
      ...mine.filter((d) => d.status === 'posted' && (d.type === 'invoice' || d.type === 'bill')).map((d) => ({ date: d.date, label: `${DOC_TYPES[d.type].label} ${d.number}`, amount: d.total })),
      ...mine.filter((d) => d.status === 'posted' && DOC_TYPES[d.type].credit).map((d) => ({ date: d.date, label: `${DOC_TYPES[d.type].label} ${d.number}`, amount: -d.total })),
      ...myPayments.filter((p) => p.status === 'posted').map((p) => ({ date: p.date, label: `Payment ${p.number}`, amount: -p.amount })),
    ].sort((a, b) => a.date.localeCompare(b.date))
    let running = 0
    return events.map((e) => ({ ...e, balance: (running += e.amount) }))
  })()

  const newDoc = kind === 'customer' ? '/sales/invoices/new' : '/purchases/bills/new'
  const archive = async () => {
    try {
      await setContactArchived(db, contact.id, !contact.archived)
      toast(contact.archived ? 'Restored' : 'Archived')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  return (
    <div>
      <PageHeader
        back={
          <Link to={base(kind)} className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> {kind === 'customer' ? 'Customers' : 'Suppliers'}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {contact.name}
            {contact.archived && <Badge>Archived</Badge>}
            {contact.type === 'both' && <Badge tone="primary">Customer & supplier</Badge>}
          </span>
        }
        description={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1 hover:text-fg">
                <Mail className="size-3.5" /> {contact.email}
              </a>
            )}
            {contact.phone && (
              <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1 hover:text-fg">
                <Phone className="size-3.5" /> {contact.phone}
              </a>
            )}
          </span>
        }
        actions={
          <>
            <LinkButton to={`${newDoc}?contact=${contact.id}`} variant="primary" icon={<Plus />}>
              {kind === 'customer' ? 'New invoice' : 'New bill'}
            </LinkButton>
            <LinkButton to={`${kind === 'customer' ? '/sales' : '/purchases'}/payments/new?contact=${contact.id}`} icon={<CreditCard />}>
              {kind === 'customer' ? 'Receive payment' : 'Pay'}
            </LinkButton>
            <Button icon={<Pencil />} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="icon" variant="ghost" aria-label={contact.archived ? 'Restore' : 'Archive'} onClick={archive}>
              {contact.archived ? <ArchiveRestore /> : <Archive />}
            </Button>
            <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => setConfirmDelete(true)}>
              <Trash2 />
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: kind === 'customer' ? 'Owes you' : 'You owe', value: balance },
          { label: 'Overdue', value: overdue, danger: overdue > 0 },
          { label: kind === 'customer' ? 'Sales this financial year' : 'Purchases this financial year', value: yearTotal },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
            <p className="text-xs text-fg-subtle">{s.label}</p>
            <p className={cn('mt-0.5 text-lg font-semibold', s.danger && 'text-danger')}>{f.money(s.value)}</p>
          </div>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <Segmented
            label="View"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'activity', label: 'Activity' },
              { value: 'statement', label: 'Statement' },
            ]}
          />
          {tab === 'statement' && (
            <Button size="sm" variant="ghost" onClick={() => window.print()}>
              Print
            </Button>
          )}
        </div>
        {tab === 'activity' ? (
          activity.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-fg-subtle">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {activity.map((a) => (
                <li key={a.key}>
                  <Link to={a.to} className="flex items-center gap-4 px-5 py-3 hover:bg-surface-2/60">
                    <span className="w-24 shrink-0 text-xs text-fg-subtle">{f.date(a.date)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.title}</span>
                    <StateBadge state={a.state} />
                    <span className="w-28 text-right text-sm tabular-nums">{f.money(a.amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-fg-subtle">
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Details</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-5 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {statement.map((s, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="px-5 py-2 text-fg-muted">{f.date(s.date)}</td>
                    <td className="px-3 py-2">{s.label}</td>
                    <td className="px-3 py-2 text-right">{f.money(s.amount)}</td>
                    <td className="px-5 py-2 text-right font-medium">{f.money(s.balance)}</td>
                  </tr>
                ))}
                {statement.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-fg-subtle">
                      No posted transactions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(contact.address || contact.notes || contact.taxId) && (
        <Card className="mt-4 grid grid-cols-1 gap-4 p-5 text-sm sm:grid-cols-3">
          {contact.address && <Detail label="Address" value={contact.address} />}
          {contact.taxId && <Detail label="Tax ID" value={contact.taxId} />}
          {contact.notes && <Detail label="Notes" value={contact.notes} />}
        </Card>
      )}

      <ContactDialog open={editing} onClose={() => setEditing(false)} type={contact.type} contact={contact as Contact} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false)
          try {
            await deleteContact(db, contact.id)
            toast('Deleted')
            navigate(base(kind), { replace: true })
          } catch (err) {
            toast(errorMessage(err), 'error')
          }
        }}
        danger
        title={`Delete ${contact.name}?`}
        description="Only contacts with no transactions can be deleted. Archive them otherwise."
        confirmLabel="Delete"
      />
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="mt-0.5 whitespace-pre-line">{value}</p>
    </div>
  )
}
