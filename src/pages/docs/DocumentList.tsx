import { FileText, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { DOC_TYPES, docState } from '../../accounting/documents'
import { StateBadge } from '../../components/StateBadge'
import { LinkButton } from '../../components/ui/button'
import { Input } from '../../components/ui/form'
import { Card, EmptyState, Spinner } from '../../components/ui/misc'
import type { DocType } from '../../db/types'
import { cn } from '../../lib/cn'
import { addDays, today } from '../../lib/dates'
import { useCompany, useFormat } from '../../state/company'
import { useContacts, useLedgerDocs } from '../../state/data'

const FILTERS: Record<string, { id: string; label: string; states: string[] }[]> = {
  payable: [
    { id: 'all', label: 'All', states: [] },
    { id: 'draft', label: 'Draft', states: ['draft'] },
    { id: 'unpaid', label: 'Unpaid', states: ['unpaid', 'partial', 'overdue'] },
    { id: 'overdue', label: 'Overdue', states: ['overdue'] },
    { id: 'paid', label: 'Paid', states: ['paid'] },
    { id: 'void', label: 'Void', states: ['void'] },
  ],
  quote: [
    { id: 'all', label: 'All', states: [] },
    { id: 'draft', label: 'Draft', states: ['draft'] },
    { id: 'open', label: 'Sent', states: ['sent', 'expired'] },
    { id: 'accepted', label: 'Accepted', states: ['accepted'] },
    { id: 'done', label: 'Closed', states: ['converted', 'declined'] },
  ],
  purchase_order: [
    { id: 'all', label: 'All', states: [] },
    { id: 'draft', label: 'Draft', states: ['draft'] },
    { id: 'issued', label: 'Issued', states: ['issued'] },
    { id: 'done', label: 'Closed', states: ['converted', 'cancelled'] },
  ],
  credit: [
    { id: 'all', label: 'All', states: [] },
    { id: 'open', label: 'Available', states: ['open'] },
    { id: 'applied', label: 'Used', states: ['applied'] },
    { id: 'draft', label: 'Draft', states: ['draft'] },
    { id: 'void', label: 'Void', states: ['void'] },
  ],
  expense: [
    { id: 'all', label: 'All', states: [] },
    { id: 'month', label: 'Last 30 days', states: [] },
    { id: 'draft', label: 'Draft', states: ['draft'] },
    { id: 'void', label: 'Void', states: ['void'] },
  ],
}

const filterSet = (type: DocType) =>
  type === 'invoice' || type === 'bill' ? FILTERS.payable : type === 'credit_note' || type === 'supplier_credit' ? FILTERS.credit : FILTERS[type]

const EMPTY_TEXT: Record<DocType, string> = {
  invoice: 'Bill your customers and see who has paid. Invoices are numbered and taxed for you.',
  quote: 'Send a price before the work starts, then turn it into an invoice in one click.',
  credit_note: 'Refund or reduce what a customer owes, for returns or mistakes.',
  bill: "Record what suppliers charge you, so you always know what's due and when.",
  purchase_order: 'Order from suppliers, then turn the order into a bill when it arrives.',
  supplier_credit: 'Record refunds or credits a supplier gives you.',
  expense: 'Record purchases you paid for straight away, with a photo of the receipt.',
}

export function DocumentList({ type }: { type: DocType }) {
  const info = DOC_TYPES[type]
  const company = useCompany()
  const f = useFormat()
  const { docs, settled } = useLedgerDocs(company.id)
  const contacts = useContacts(company.id)
  const [query, setQuery] = useState('')
  const filters = filterSet(type)
  const [filter, setFilter] = useState(filters[0].id)

  const rows = useMemo(() => {
    if (!docs || !settled || !contacts) return null
    const names = new Map(contacts.map((c) => [c.id, c.name]))
    const now = today()
    return docs
      .filter((d) => d.type === type)
      .map((d) => {
        const paid = settled.get(d.id) ?? 0
        return { doc: d, state: docState(d, paid), due: info.credit ? d.total - (d.allocations ?? []).reduce((s, a) => s + a.amount, 0) : d.total - paid, contact: d.contactId ? (names.get(d.contactId) ?? '') : '' }
      })
      .sort((a, b) => b.doc.date.localeCompare(a.doc.date) || b.doc.number.localeCompare(a.doc.number))
      .map((r) => ({ ...r, recent: r.doc.date >= addDays(now, -30) }))
  }, [docs, settled, contacts, type, info.credit])

  if (!rows) return <Spinner />

  const active = filters.find((x) => x.id === filter)!
  const q = query.trim().toLowerCase()
  const visible = rows.filter(
    (r) =>
      (!active.states.length || active.states.includes(r.state)) &&
      (active.id !== 'month' || r.recent) &&
      (!q || r.doc.number.toLowerCase().includes(q) || r.contact.toLowerCase().includes(q) || r.doc.reference?.toLowerCase().includes(q)),
  )

  type Row = (typeof rows)[number]
  const live = rows.filter((r) => r.state !== 'void' && r.state !== 'draft')
  const sum = (pred: (r: Row) => boolean, pick: (r: Row) => number) => live.filter(pred).reduce((s, r) => s + pick(r), 0)
  const stats: { label: string; value: number; tone?: string }[] =
    type === 'invoice' || type === 'bill'
      ? [
          { label: type === 'invoice' ? 'Waiting to be paid' : 'To pay', value: sum((r) => r.due > 0, (r) => r.due) },
          { label: 'Overdue', value: sum((r) => r.state === 'overdue', (r) => r.due), tone: 'text-danger' },
          { label: 'Billed in the last 30 days', value: sum((r) => r.recent, (r) => r.doc.total) },
        ]
      : type === 'quote'
        ? [
            { label: 'Open quotes', value: sum((r) => r.state === 'sent' || r.state === 'accepted', (r) => r.doc.total) },
            { label: 'Won (converted)', value: sum((r) => r.state === 'converted', (r) => r.doc.total) },
          ]
        : type === 'expense'
          ? [{ label: 'Spent in the last 30 days', value: sum((r) => r.recent, (r) => r.doc.total) }]
          : info.credit
            ? [{ label: 'Available to use', value: sum((r) => r.state === 'open', (r) => r.due) }]
            : [{ label: 'Open orders', value: sum((r) => r.state === 'issued', (r) => r.doc.total) }]

  return (
    <div>
      <div className={cn('mb-4 grid gap-3', stats.length === 1 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3')}>
        {stats.map((s, i) => (
          <div key={s.label} className={cn('rounded-2xl border border-line bg-surface px-4 py-3 shadow-card', stats.length === 3 && i === 2 && 'max-sm:col-span-2')}>
            <p className="text-xs text-fg-subtle">{s.label}</p>
            <p className={cn('mt-0.5 text-lg font-semibold', s.value && s.tone ? s.tone : 'text-fg')}>{f.money(s.value)}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Filter">
          {filters.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={filter === x.id}
              onClick={() => setFilter(x.id)}
              className={cn(
                'h-8 shrink-0 rounded-full px-3 text-[13px] font-medium transition-colors',
                filter === x.id ? 'bg-fg text-bg' : 'bg-surface-2 text-fg-muted ring-1 ring-line hover:text-fg',
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 lg:ml-auto">
          <div className="relative flex-1 lg:w-64 lg:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label={`Search ${info.plural.toLowerCase()}`} className="pl-9" />
          </div>
          <LinkButton to={`${info.path}/new`} variant="primary" icon={<Plus />}>
            <span className="hidden sm:inline">New {info.label.toLowerCase()}</span>
            <span className="sm:hidden">New</span>
          </LinkButton>
        </div>
      </div>

      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title={rows.length ? `No ${info.plural.toLowerCase()} match` : `No ${info.plural.toLowerCase()} yet`}
            description={rows.length ? 'Try another filter or search.' : EMPTY_TEXT[type]}
            action={!rows.length && <LinkButton to={`${info.path}/new`} variant="primary" icon={<Plus />}>New {info.label.toLowerCase()}</LinkButton>}
          />
        ) : (
          <>
            <div className="hidden grid-cols-[8rem_minmax(0,1fr)_7rem_7rem_8rem_8rem_6.5rem] gap-3 border-b border-line px-5 py-2.5 text-xs font-medium text-fg-subtle md:grid">
              <span>Number</span>
              <span>{info.contactLabel}</span>
              <span>Date</span>
              <span>{info.dueLabel ?? ''}</span>
              <span className="text-right">Total</span>
              <span className="text-right">{info.posts && type !== 'expense' ? (info.credit ? 'Left to use' : 'Balance due') : ''}</span>
              <span className="text-right">Status</span>
            </div>
            <ul className="divide-y divide-line">
              {visible.map(({ doc, state, due, contact }) => (
                <li key={doc.id}>
                  <Link
                    to={`${info.path}/${doc.id}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-5 py-3 transition-colors hover:bg-surface-2/60 md:grid-cols-[8rem_minmax(0,1fr)_7rem_7rem_8rem_8rem_6.5rem] md:items-center md:gap-3"
                  >
                    <span className="truncate text-sm font-medium text-fg md:order-none">{doc.number}</span>
                    <span className="truncate text-sm text-fg max-md:order-3 max-md:text-fg-muted">{contact || doc.lines[0]?.description || '—'}</span>
                    <span className="text-sm text-fg-muted max-md:hidden">{f.date(doc.date)}</span>
                    <span className="text-sm text-fg-muted max-md:hidden">{doc.dueDate ? f.date(doc.dueDate) : ''}</span>
                    <span className="text-right text-sm font-semibold text-fg tabular-nums max-md:order-2">{f.money(doc.total)}</span>
                    <span className="text-right text-sm text-fg-muted tabular-nums max-md:hidden">{info.posts && type !== 'expense' && state !== 'void' && state !== 'draft' ? f.money(due) : ''}</span>
                    <span className="text-right max-md:order-4">
                      <StateBadge state={state} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  )
}
