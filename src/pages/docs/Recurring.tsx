import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, MoreHorizontal, Pause, Pencil, Play, Plus, Repeat, Trash2, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { computeTotals, DOC_TYPES, docState } from '../../accounting/documents'
import { errorMessage } from '../../accounting/errors'
import { createNextNow, deleteRecurring, describeSchedule, nextDate, setRecurringPaused } from '../../accounting/recurring'
import { StateBadge } from '../../components/StateBadge'
import { Button, LinkButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { Badge, Card, EmptyState, Spinner } from '../../components/ui/misc'
import { Menu, MenuItem } from '../../components/ui/menu'
import { useToast } from '../../components/ui/toast'
import { db } from '../../db'
import type { Recurring, TaxRate } from '../../db/types'
import { useCompany, useFormat } from '../../state/company'
import { useContacts, useLedgerDocs, useTaxRates } from '../../state/data'
import { DocumentForm, recurringPath } from './DocumentForm'

type Side = 'sales' | 'purchases'

const STATUS: Record<Recurring['status'], { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  active: { label: 'Active', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  ended: { label: 'Ended', tone: 'neutral' },
}

function useSchedules(companyId: string) {
  return useLiveQuery(() => db.recurring.where('companyId').equals(companyId).toArray(), [companyId])
}

function templateTotal(r: Recurring, taxRates: TaxRate[]) {
  return computeTotals(r.template.lines, new Map(taxRates.map((t) => [t.id, t])), r.template.taxInclusive, DOC_TYPES[r.docType].side).total
}

function endsText(r: Recurring, f: ReturnType<typeof useFormat>) {
  if (r.endDate) return `Until ${f.date(r.endDate)}`
  if (r.maxCount !== undefined) return `${r.createdCount} of ${r.maxCount} created`
  return 'No end date'
}

export function RecurringList({ side }: { side: Side }) {
  const company = useCompany()
  const f = useFormat()
  const schedules = useSchedules(company.id)
  const contacts = useContacts(company.id)
  const taxRates = useTaxRates(company.id)
  const base = recurringPath(side)

  const rows = useMemo(() => {
    if (!schedules || !contacts || !taxRates) return null
    const names = new Map(contacts.map((c) => [c.id, c.name]))
    const order = { active: 0, paused: 1, ended: 2 }
    return schedules
      .filter((r) => DOC_TYPES[r.docType].side === side)
      .map((r) => ({ r, contact: r.template.contactId ? names.get(r.template.contactId) : undefined, total: templateTotal(r, taxRates), next: nextDate(r) }))
      .sort((a, b) => order[a.r.status] - order[b.r.status] || (a.next ?? '9').localeCompare(b.next ?? '9') || a.r.name.localeCompare(b.r.name))
  }, [schedules, contacts, taxRates, side])

  if (!rows) return <Spinner />

  const actions =
    side === 'sales' ? (
      <LinkButton to={`${base}/new`} variant="primary" icon={<Plus />}>
        New recurring invoice
      </LinkButton>
    ) : (
      <>
        <LinkButton to={`${base}/new?type=expense`} icon={<Plus />}>
          Recurring expense
        </LinkButton>
        <LinkButton to={`${base}/new?type=bill`} variant="primary" icon={<Plus />}>
          Recurring bill
        </LinkButton>
      </>
    )
  const monthly = rows.filter((x) => x.r.status === 'active').reduce((s, x) => s + perMonth(x.r, x.total), 0)

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm text-fg-muted">
          {side === 'sales'
            ? 'Invoices that repeat, like rent, retainers or subscriptions. Each one is created on its date with the next number.'
            : 'Bills and expenses that repeat, like rent, software or loan payments.'}
          {monthly > 0 && (
            <>
              {' '}
              About <span className="font-medium text-fg">{f.money(monthly)}</span> a month.
            </>
          )}
        </p>
        <div className="flex shrink-0 gap-2">{rows.length > 0 && actions}</div>
      </div>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Repeat />}
            title={side === 'sales' ? 'No recurring invoices yet' : 'No recurring bills or expenses yet'}
            description={
              side === 'sales'
                ? 'Set up an invoice once and it is created for you every week, month or year. You can also open any invoice and choose “Make recurring”.'
                : 'Set up a bill or expense once and it is recorded for you on each date.'
            }
            action={<div className="flex flex-wrap justify-center gap-2">{actions}</div>}
          />
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_9rem_8rem_8rem_6rem] gap-3 border-b border-line px-5 py-2.5 text-xs font-medium text-fg-subtle md:grid">
              <span>Name</span>
              <span>{side === 'sales' ? 'Customer' : 'Supplier'}</span>
              <span>Repeats</span>
              <span>Next</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Status</span>
            </div>
            <ul className="divide-y divide-line">
              {rows.map(({ r, contact, total, next }) => (
                <li key={r.id}>
                  <Link
                    to={`${base}/${r.id}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-5 py-3 transition-colors hover:bg-surface-2/60 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_9rem_8rem_8rem_6rem] md:items-center md:gap-3"
                  >
                    <span className="truncate text-sm font-medium text-fg">
                      {r.name}
                      {side === 'purchases' && <span className="ml-1.5 text-xs font-normal text-fg-subtle">{DOC_TYPES[r.docType].label}</span>}
                    </span>
                    <span className="truncate text-sm text-fg-muted max-md:order-3">{contact ?? '—'}</span>
                    <span className="text-sm text-fg-muted max-md:hidden">{describeSchedule(r)}</span>
                    <span className="text-sm text-fg-muted max-md:order-5 max-md:col-span-2 max-md:text-xs">{next ? <><span className="md:hidden">{describeSchedule(r)} · next </span>{f.date(next)}</> : '—'}</span>
                    <span className="text-right text-sm font-semibold text-fg tabular-nums max-md:order-2">{f.money(total)}</span>
                    <span className="text-right max-md:order-4">
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
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

const PER_MONTH = { week: 52 / 12, month: 1, quarter: 1 / 3, year: 1 / 12 }
const perMonth = (r: Recurring, total: number) => Math.round((total * PER_MONTH[r.unit]) / r.every)

export function RecurringView({ side }: { side: Side }) {
  const { id = '' } = useParams()
  const company = useCompany()
  const f = useFormat()
  const toast = useToast()
  const navigate = useNavigate()
  const r = useLiveQuery(async () => (await db.recurring.get(id)) ?? null, [id])
  const contact = useLiveQuery(async () => (r?.template.contactId ? ((await db.contacts.get(r.template.contactId)) ?? null) : null), [r?.template.contactId])
  const taxRates = useTaxRates(company.id)
  const { docs, settled } = useLedgerDocs(company.id)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const base = recurringPath(side)

  if (r === undefined || !taxRates || !docs || !settled) return <Spinner />
  if (r === null || r.companyId !== company.id || DOC_TYPES[r.docType].side !== side) {
    return (
      <Card>
        <EmptyState title="Schedule not found" action={<Link to={base} className="text-sm font-medium text-primary-ink">Back to recurring</Link>} />
      </Card>
    )
  }

  const info = DOC_TYPES[r.docType]
  const total = templateTotal(r, taxRates)
  const next = nextDate(r)
  const created = docs.filter((d) => d.recurringId === r.id).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn()
      toast(message)
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }
  const createNow = async () => {
    try {
      const doc = await createNextNow(db, r.id)
      if (!doc) return toast('That one was already created', 'info')
      toast(`${info.label} ${doc.number} created${doc.status === 'draft' ? ' as a draft' : ''}`)
      navigate(`${info.path}/${doc.id}`)
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const details: [string, string][] = [
    ['Repeats', describeSchedule(r)],
    ['Next', next ? f.date(next) : r.status === 'paused' ? 'Paused' : 'No more to create'],
    ['Ends', endsText(r, f)],
    [info.side === 'sales' ? 'Customer' : 'Supplier', contact?.name ?? '—'],
    ['Amount', f.money(total)],
    ['When created', r.autoApprove ? 'Approved straight into your books' : 'Saved as a draft to check'],
  ]
  if (r.docType !== 'expense') details.splice(5, 0, ['Payment due', r.template.dueInDays ? `${r.template.dueInDays} days after each date` : 'On receipt'])

  return (
    <div>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <Link to={base} className="mb-2 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> Recurring
          </Link>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {r.name} <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
          </h1>
          <p className="mt-1 text-sm text-fg-muted">Recurring {info.label.toLowerCase()}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {r.status !== 'ended' && (
            <Button variant="primary" icon={<Zap />} onClick={createNow}>
              Create next one now
            </Button>
          )}
          {r.status === 'active' && (
            <Button icon={<Pause />} onClick={() => run(() => setRecurringPaused(db, r.id, true), 'Paused. Nothing more is created until you resume.')}>
              Pause
            </Button>
          )}
          {r.status === 'paused' && (
            <Button icon={<Play />} onClick={() => run(() => setRecurringPaused(db, r.id, false), 'Resumed. Dates missed while paused are skipped.')}>
              Resume
            </Button>
          )}
          <LinkButton to={`${base}/${r.id}/edit`} icon={<Pencil />}>
            Edit
          </LinkButton>
          <Menu
            align="end"
            trigger={({ toggle }) => (
              <Button size="icon" onClick={toggle} aria-label="More actions">
                <MoreHorizontal />
              </Button>
            )}
          >
            {(close) => (
              <MenuItem danger icon={<Trash2 />} onClick={() => (close(), setConfirmDelete(true))}>
                Delete schedule
              </MenuItem>
            )}
          </Menu>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="overflow-hidden">
          <h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold">Created so far</h2>
          {created.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-fg-muted">{next ? `The first one will be created on ${f.date(next)}.` : 'None yet.'}</p>
          ) : (
            <ul className="divide-y divide-line">
              {created.map((d) => (
                <li key={d.id}>
                  <Link to={`${info.path}/${d.id}`} className="grid grid-cols-[minmax(0,1fr)_auto_6rem] items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2/60">
                    <span className="min-w-0 truncate text-sm">
                      <span className="font-medium">{d.number}</span>
                      <span className="ml-2 text-fg-muted">{f.date(d.date)}</span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{f.money(d.total)}</span>
                    <span className="text-right">
                      <StateBadge state={docState(d, settled.get(d.id) ?? 0)} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <dl className="space-y-3 text-sm">
            {details.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-fg-subtle">{k}</dt>
                <dd className="mt-0.5 text-fg">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-xs text-fg-subtle">Each one includes</p>
            <ul className="mt-1 space-y-1 text-sm">
              {r.template.lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{l.description || 'Item'}</span>
                  <span className="text-fg-muted tabular-nums">{f.money(Math.round(l.quantity * l.rate * (1 - (l.discountPct ?? 0) / 100)))}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false)
          try {
            await deleteRecurring(db, r.id)
            toast('Schedule deleted')
            navigate(base, { replace: true })
          } catch (err) {
            toast(errorMessage(err), 'error')
          }
        }}
        danger
        title={`Delete "${r.name}"?`}
        description={`No more ${info.plural.toLowerCase()} will be created.${created.length ? ` The ${created.length} already created stay as they are.` : ''}`}
        confirmLabel="Delete"
      />
    </div>
  )
}

/** New or edit schedule: the document form in schedule mode, for the right kind of document. */
export function RecurringForm({ side }: { side: Side }) {
  const { id } = useParams()
  const [params] = useSearchParams()
  const existing = useLiveQuery(async () => (id ? ((await db.recurring.get(id)) ?? null) : null), [id])
  const source = useLiveQuery(async () => (params.get('from') ? ((await db.documents.get(params.get('from')!)) ?? null) : null), [params])
  if (existing === undefined || source === undefined) return <Spinner />
  const wanted = existing?.docType ?? source?.type ?? params.get('type')
  const type = side === 'sales' ? 'invoice' : wanted === 'expense' ? 'expense' : 'bill'
  return <DocumentForm key={`${id ?? 'new'}-${type}`} type={type} schedule />
}
