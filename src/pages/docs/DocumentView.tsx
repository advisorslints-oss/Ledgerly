import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Ban, BellRing, CalendarSync, Check, Copy, CreditCard, Link2, Mail, MessageCircle, MoreHorizontal, Pencil, Printer, Repeat, Send, Share2, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { getCountry } from '../../accounting/countries'
import {
  applyCredit,
  computeTotals,
  convertDocument,
  deleteDocument,
  DOC_TYPES,
  docState,
  duplicateDocument,
  saveDocument,
  setDocumentStatus,
  SETTLES,
  voidDocument,
} from '../../accounting/documents'
import { errorMessage } from '../../accounting/errors'
import { AmountInput } from '../../components/AmountInput'
import { Attachments } from '../../components/Attachments'
import { StateBadge } from '../../components/StateBadge'
import { Button, LinkButton } from '../../components/ui/button'
import { ConfirmDialog, Dialog } from '../../components/ui/dialog'
import { Card, EmptyState, Spinner } from '../../components/ui/misc'
import { Menu, MenuItem } from '../../components/ui/menu'
import { useToast } from '../../components/ui/toast'
import { db } from '../../db'
import type { Allocation, Contact, Doc, DocType } from '../../db/types'
import { fromISODate, toISODate, today } from '../../lib/dates'
import { useCompany, useFormat } from '../../state/company'
import { useLedgerDocs, useTaxRates } from '../../state/data'
import { howToPay, payOptions } from '../../accounting/paylinks'
import { daysOverdue as daysPast, reachedStage, reminderSettings } from '../../accounting/reminders'
import { QrCode } from '../../components/QrCode'
import { recurringPath, Totals } from './DocumentForm'
import { ReminderDialog } from './Reminders'

export function DocumentView({ type }: { type: DocType }) {
  const info = DOC_TYPES[type]
  const { id = '' } = useParams()
  const company = useCompany()
  const f = useFormat()
  const toast = useToast()
  const navigate = useNavigate()
  const doc = useLiveQuery(async () => (await db.documents.get(id)) ?? null, [id])
  const contact = useLiveQuery(async () => (doc?.contactId ? ((await db.contacts.get(doc.contactId)) ?? null) : null), [doc?.contactId])
  const taxRates = useTaxRates(company.id)
  const { docs, payments, settled } = useLedgerDocs(company.id)
  const [confirm, setConfirm] = useState<'void' | 'delete' | null>(null)
  const [applying, setApplying] = useState(false)
  const [reminding, setReminding] = useState(false)
  const reminders = useLiveQuery(() => db.reminders.where('documentId').equals(id).toArray(), [id])
  const schedule = useLiveQuery(async () => (doc?.recurringId ? ((await db.recurring.get(doc.recurringId)) ?? null) : null), [doc?.recurringId])

  const totals = useMemo(() => (doc && taxRates ? computeTotals(doc.lines, new Map(taxRates.map((t) => [t.id, t])), doc.taxInclusive, info.side) : null), [doc, taxRates, info.side])

  if (doc === undefined || !totals || !settled || !docs || !payments) return <Spinner />
  if (doc === null || doc.companyId !== company.id || doc.type !== type) {
    return (
      <Card>
        <EmptyState title={`${info.label} not found`} action={<Link to={info.path} className="text-sm font-medium text-primary-ink">Back to {info.plural.toLowerCase()}</Link>} />
      </Card>
    )
  }

  const paid = settled.get(doc.id) ?? 0
  const creditUsed = (doc.allocations ?? []).reduce((s, a) => s + a.amount, 0)
  const state = docState(doc, paid)
  const due = info.credit ? doc.total - creditUsed : doc.total - paid
  const history = [
    ...payments
      .filter((p) => p.status === 'posted')
      .flatMap((p) => p.allocations.filter((a) => a.documentId === doc.id).map((a) => ({ id: p.id, date: p.date, label: `Payment ${p.number}`, amount: a.amount, to: `${p.direction === 'in' ? '/sales' : '/purchases'}/payments/${p.id}` }))),
    ...docs
      .filter((d) => d.status === 'posted' && DOC_TYPES[d.type].credit)
      .flatMap((d) => (d.allocations ?? []).filter((a) => a.documentId === doc.id).map((a) => ({ id: d.id, date: d.date, label: `${DOC_TYPES[d.type].label} ${d.number}`, amount: a.amount, to: `${DOC_TYPES[d.type].path}/${d.id}` }))),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const appliedTo = info.credit ? (doc.allocations ?? []).map((a) => ({ a, target: docs.find((d) => d.id === a.documentId) })) : []

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn()
      toast(message)
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }
  const approve = () =>
    run(
      () =>
        saveDocument(
          db,
          company.id,
          { type: doc.type, number: doc.number, contactId: doc.contactId, date: doc.date, dueDate: doc.dueDate, reference: doc.reference, lines: doc.lines, taxInclusive: doc.taxInclusive, notes: doc.notes, terms: doc.terms, paidFromAccountId: doc.paidFromAccountId },
          { id: doc.id, post: true },
        ),
      `${info.label} ${doc.number} is now in your books`,
    )
  const convert = async () => {
    try {
      const created = await convertDocument(db, doc.id)
      toast(`Created ${DOC_TYPES[created.type].label.toLowerCase()} ${created.number}. Check it, then save.`)
      navigate(`${DOC_TYPES[created.type].path}/${created.id}/edit`)
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }
  const duplicate = async () => {
    try {
      const copy = await duplicateDocument(db, doc.id)
      navigate(`${info.path}/${copy.id}/edit`)
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const editable = doc.status !== 'void' && doc.status !== 'converted'
  const paymentsPath = `${info.side === 'sales' ? '/sales' : '/purchases'}/payments/new?doc=${doc.id}`
  const daysOverdue = state === 'overdue' && doc.dueDate ? Math.floor((fromISODate(today()).getTime() - fromISODate(doc.dueDate).getTime()) / 86_400_000) : 0
  const canRemind = type === 'invoice' && doc.status === 'posted' && due > 0 && !!doc.dueDate
  const stage = doc.dueDate ? reachedStage(reminderSettings(company), daysPast(doc.dueDate)) : undefined
  const canRepeat = (type === 'invoice' || type === 'bill' || type === 'expense') && doc.status !== 'void'

  return (
    <div>
      <div className="no-print mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <Link to={info.path} className="mb-2 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> {info.plural}
          </Link>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {info.label} {doc.number} <StateBadge state={state} />
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {contact?.name ?? (type === 'expense' ? 'No supplier' : '')}
            {info.posts && type !== 'expense' && doc.status === 'posted' && (
              <>
                {' · '}
                <span className={state === 'overdue' ? 'font-medium text-danger' : undefined}>
                  {info.credit ? `${f.money(due)} left to use` : due > 0 ? `${f.money(due)} due${daysOverdue ? `, ${daysOverdue} days overdue` : doc.dueDate ? ` by ${f.date(doc.dueDate)}` : ''}` : 'Fully paid'}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {doc.status === 'draft' && info.posts && (
            <Button variant="primary" icon={<Check />} onClick={approve}>
              Approve
            </Button>
          )}
          {doc.status === 'posted' && !info.credit && type !== 'expense' && due > 0 && (
            <LinkButton to={paymentsPath} variant="primary" icon={<CreditCard />}>
              Record payment
            </LinkButton>
          )}
          {doc.status === 'posted' && info.credit && due > 0 && (
            <Button variant="primary" icon={<CreditCard />} onClick={() => setApplying(true)}>
              Apply credit
            </Button>
          )}
          {type === 'quote' && doc.status === 'draft' && (
            <Button variant="primary" icon={<Send />} onClick={() => run(() => setDocumentStatus(db, doc.id, 'sent'), 'Marked as sent')}>
              Mark as sent
            </Button>
          )}
          {type === 'purchase_order' && doc.status === 'draft' && (
            <Button variant="primary" icon={<Send />} onClick={() => run(() => setDocumentStatus(db, doc.id, 'issued'), 'Marked as issued')}>
              Mark as issued
            </Button>
          )}
          {info.convertsTo && editable && doc.status !== 'declined' && doc.status !== 'cancelled' && (
            <Button variant={doc.status === 'draft' ? 'secondary' : 'primary'} icon={<Repeat />} onClick={convert}>
              Convert to {DOC_TYPES[info.convertsTo].label.toLowerCase()}
            </Button>
          )}
          {editable && (
            <LinkButton to={`${info.path}/${doc.id}/edit`} icon={<Pencil />}>
              Edit
            </LinkButton>
          )}
          {canRemind && state === 'overdue' && (
            <Button icon={<BellRing />} onClick={() => setReminding(true)}>
              Send reminder
            </Button>
          )}
          <ShareMenu doc={doc} contact={contact ?? undefined} due={due} onRemind={canRemind && state !== 'overdue' ? () => setReminding(true) : undefined} />
          <Menu
            align="end"
            trigger={({ toggle }) => (
              <Button size="icon" onClick={toggle} aria-label="More actions">
                <MoreHorizontal />
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuItem icon={<Printer />} onClick={() => (close(), window.print())}>
                  Print or save as PDF
                </MenuItem>
                <MenuItem icon={<Copy />} onClick={() => (close(), void duplicate())}>
                  Duplicate
                </MenuItem>
                {canRepeat && (
                  <MenuItem icon={<CalendarSync />} onClick={() => (close(), navigate(`${recurringPath(info.side)}/new?from=${doc.id}`))}>
                    Make recurring
                  </MenuItem>
                )}
                {type === 'quote' && (doc.status === 'sent' || doc.status === 'draft') && (
                  <>
                    <MenuItem icon={<Check />} onClick={() => (close(), void run(() => setDocumentStatus(db, doc.id, 'accepted'), 'Marked as accepted'))}>
                      Mark as accepted
                    </MenuItem>
                    <MenuItem icon={<X />} onClick={() => (close(), void run(() => setDocumentStatus(db, doc.id, 'declined'), 'Marked as declined'))}>
                      Mark as declined
                    </MenuItem>
                  </>
                )}
                {type === 'purchase_order' && doc.status === 'issued' && (
                  <MenuItem icon={<X />} onClick={() => (close(), void run(() => setDocumentStatus(db, doc.id, 'cancelled'), 'Order cancelled'))}>
                    Cancel order
                  </MenuItem>
                )}
                {doc.status === 'posted' && (
                  <MenuItem danger icon={<Ban />} onClick={() => (close(), setConfirm('void'))}>
                    Void
                  </MenuItem>
                )}
                {(!info.posts || doc.status === 'draft') && (
                  <MenuItem danger icon={<Trash2 />} onClick={() => (close(), setConfirm('delete'))}>
                    Delete
                  </MenuItem>
                )}
              </>
            )}
          </Menu>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <Paper doc={doc} contact={contact ?? undefined} totals={totals} paid={info.credit ? creditUsed : paid} />
        <aside className="no-print flex flex-col gap-4">
          {(history.length > 0 || appliedTo.length > 0) && (
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold">{info.credit ? 'Applied to' : 'Payments'}</h2>
              <ul className="space-y-2 text-sm">
                {history.map((h, i) => (
                  <li key={`${h.id}-${i}`} className="flex items-center justify-between gap-2">
                    <Link to={h.to} className="min-w-0 truncate text-fg hover:text-primary-ink">
                      {h.label}
                      <span className="block text-xs text-fg-subtle">{f.date(h.date)}</span>
                    </Link>
                    <span className="tabular-nums">{f.money(h.amount)}</span>
                  </li>
                ))}
                {appliedTo.map(({ a, target }) => (
                  <li key={a.documentId} className="flex items-center justify-between gap-2">
                    {target ? (
                      <Link to={`${DOC_TYPES[target.type].path}/${target.id}`} className="text-fg hover:text-primary-ink">
                        {DOC_TYPES[target.type].label} {target.number}
                      </Link>
                    ) : (
                      <span>Removed document</span>
                    )}
                    <span className="tabular-nums">{f.money(a.amount)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {doc.entryId && (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 text-sm font-semibold">In your books</h2>
              <Link to={`/journal/${doc.entryId}`} className="text-primary-ink hover:underline">
                View the journal entry
              </Link>
            </Card>
          )}
          {schedule && (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 text-sm font-semibold">Recurring</h2>
              <p className="text-fg-muted">
                Created by{' '}
                <Link to={`${recurringPath(info.side)}/${schedule.id}`} className="font-medium text-primary-ink hover:underline">
                  {schedule.name}
                </Link>
              </p>
            </Card>
          )}
          {type === 'invoice' && reminders && reminders.length > 0 && (
            <Card className="p-4 text-sm">
              <h2 className="mb-2 text-sm font-semibold">Reminders sent</h2>
              <ul className="space-y-1 text-fg-muted">
                {[...reminders]
                  .sort((a, b) => b.sentAt - a.sentAt)
                  .map((r) => (
                    <li key={r.id}>
                      {f.date(toISODate(new Date(r.sentAt)))} · {r.channel === 'manual' ? 'marked as sent' : r.channel === 'copy' ? 'copied' : `by ${r.channel === 'whatsapp' ? 'WhatsApp' : 'email'}`}
                    </li>
                  ))}
              </ul>
            </Card>
          )}
          {(doc.convertedFromId || doc.convertedToId) && (
            <Card className="p-4 text-sm">
              <ConvertedLinks doc={doc} docs={docs} />
            </Card>
          )}
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Attachments</h2>
            <Attachments parentId={doc.id} readOnly={!editable} />
          </Card>
        </aside>
      </div>

      {applying && <ApplyCreditDialog credit={doc} docs={docs} settled={settled} onClose={() => setApplying(false)} />}
      {reminding && doc.dueDate && stage && (
        <ReminderDialog doc={doc} due={due} stageIndex={stage.index} tone={stage.stage.tone} daysOverdue={daysPast(doc.dueDate)} onClose={() => setReminding(false)} />
      )}
      <ConfirmDialog
        open={confirm === 'void'}
        onClose={() => setConfirm(null)}
        onConfirm={() => (setConfirm(null), void run(() => voidDocument(db, doc.id), `${info.label} ${doc.number} voided`))}
        danger
        title={`Void ${info.label.toLowerCase()} ${doc.number}?`}
        description="Its entry is cancelled in your books and it stays on file marked Void. This can't be undone."
        confirmLabel="Void"
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null)
          try {
            await deleteDocument(db, doc.id)
            toast(`${info.label} deleted`)
            navigate(info.path, { replace: true })
          } catch (err) {
            toast(errorMessage(err), 'error')
          }
        }}
        danger
        title={`Delete ${info.label.toLowerCase()} ${doc.number}?`}
        description="It will be removed completely. This can't be undone."
        confirmLabel="Delete"
      />
    </div>
  )
}

function ConvertedLinks({ doc, docs }: { doc: Doc; docs: Doc[] }) {
  const from = docs.find((d) => d.id === doc.convertedFromId)
  const to = docs.find((d) => d.id === doc.convertedToId)
  return (
    <div className="space-y-1">
      {from && (
        <p>
          Created from{' '}
          <Link to={`${DOC_TYPES[from.type].path}/${from.id}`} className="font-medium text-primary-ink hover:underline">
            {DOC_TYPES[from.type].label.toLowerCase()} {from.number}
          </Link>
        </p>
      )}
      {to && (
        <p>
          Converted to{' '}
          <Link to={`${DOC_TYPES[to.type].path}/${to.id}`} className="font-medium text-primary-ink hover:underline">
            {DOC_TYPES[to.type].label.toLowerCase()} {to.number}
          </Link>
        </p>
      )}
    </div>
  )
}

/** The document as the customer or supplier sees it. White like paper in both themes, and print-ready. */
export function Paper({ doc, contact, totals, paid }: { doc: Doc; contact?: Contact; totals: ReturnType<typeof computeTotals>; paid: number }) {
  const company = useCompany()
  const f = useFormat()
  const info = DOC_TYPES[doc.type]
  const settings = company.documentSettings ?? {}
  const accent = settings.accent ?? '#4f46e5'
  const country = getCountry(company.country)
  const showTax = totals.taxTotal > 0
  const title = doc.type === 'invoice' && showTax && company.taxId ? 'Tax invoice' : doc.type === 'expense' ? 'Expense' : info.label
  const hasDiscount = doc.lines.some((l) => l.discountPct)
  const lineTotals = new Map(totals.lines.map((l) => [l.lineId, l]))
  // Drafts show it too, so the printed invoice is ready to send once approved.
  const due = totals.total - paid
  const pay = payOptions(company, doc, due)

  return (
    <article className="paper mx-auto w-full max-w-[860px] overflow-hidden rounded-2xl border border-line bg-white text-[13px] text-gray-800 shadow-card print:max-w-none print:rounded-none print:border-0 print:shadow-none">
      <div className="h-1.5" style={{ background: accent }} />
      <div className="p-6 sm:p-10">
        <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {settings.logo ? <img src={settings.logo} alt="" className="mb-3 max-h-16 max-w-48 object-contain" /> : null}
            <p className="text-base font-semibold text-gray-900">{company.legalName || company.name}</p>
            {company.address && <p className="whitespace-pre-line text-gray-600">{company.address}</p>}
            <p className="text-gray-600">{[company.email, company.phone].filter(Boolean).join(' · ')}</p>
            {company.taxId && (
              <p className="text-gray-600">
                {country.taxIdLabel}: {company.taxId}
              </p>
            )}
          </div>
          <div className="sm:text-right">
            <p className="text-2xl font-semibold tracking-tight uppercase" style={{ color: accent }}>
              {title}
            </p>
            <dl className="mt-2 grid grid-cols-[auto_auto] justify-start gap-x-4 gap-y-0.5 sm:justify-end">
              <dt className="text-gray-500">Number</dt>
              <dd className="font-medium text-gray-900">{doc.number}</dd>
              <dt className="text-gray-500">Date</dt>
              <dd className="text-gray-900">{f.date(doc.date)}</dd>
              {doc.dueDate && info.dueLabel && (
                <>
                  <dt className="text-gray-500">{info.dueLabel}</dt>
                  <dd className="text-gray-900">{f.date(doc.dueDate)}</dd>
                </>
              )}
              {doc.reference && (
                <>
                  <dt className="text-gray-500">Reference</dt>
                  <dd className="text-gray-900">{doc.reference}</dd>
                </>
              )}
            </dl>
          </div>
        </header>

        {contact && (
          <section className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[11px] font-semibold tracking-wider text-gray-500 uppercase">{info.side === 'sales' ? 'Bill to' : 'Supplier'}</p>
              <p className="font-semibold text-gray-900">{contact.name}</p>
              {contact.contactPerson && <p className="text-gray-600">Attn: {contact.contactPerson}</p>}
              {contact.address && <p className="whitespace-pre-line text-gray-600">{contact.address}</p>}
              {contact.email && <p className="text-gray-600">{contact.email}</p>}
              {contact.taxId && (
                <p className="text-gray-600">
                  {country.taxIdLabel}: {contact.taxId}
                </p>
              )}
            </div>
            {contact.shippingAddress && info.side === 'sales' && (
              <div>
                <p className="mb-1 text-[11px] font-semibold tracking-wider text-gray-500 uppercase">Ship to</p>
                <p className="whitespace-pre-line text-gray-600">{contact.shippingAddress}</p>
              </div>
            )}
          </section>
        )}

        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr className="border-b-2 text-left text-[11px] tracking-wider text-gray-500 uppercase" style={{ borderColor: accent }}>
                <th className="py-2 pr-2 font-semibold">Description</th>
                <th className="px-2 py-2 text-right font-semibold">Qty</th>
                <th className="px-2 py-2 text-right font-semibold">Price</th>
                {hasDiscount && <th className="px-2 py-2 text-right font-semibold">Disc.</th>}
                {showTax && <th className="px-2 py-2 text-right font-semibold">Tax</th>}
                <th className="py-2 pl-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {doc.lines.map((l) => {
                const lt = lineTotals.get(l.id)
                return (
                  <tr key={l.id} className="border-b border-gray-200 align-top">
                    <td className="py-2.5 pr-2 whitespace-pre-line text-gray-900">{l.description}</td>
                    <td className="px-2 py-2.5 text-right">{l.quantity}</td>
                    <td className="px-2 py-2.5 text-right">{f.money(l.rate)}</td>
                    {hasDiscount && <td className="px-2 py-2.5 text-right">{l.discountPct ? `${l.discountPct}%` : ''}</td>}
                    {showTax && <td className="px-2 py-2.5 text-right text-gray-600">{lt?.parts.length ? `${lt.parts.reduce((s, p) => s + p.rate, 0)}%` : '—'}</td>}
                    <td className="py-2.5 pl-2 text-right text-gray-900">{f.money(lt?.gross ?? 0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex justify-end text-gray-700 [&_dd]:text-gray-900 [&_dt]:text-gray-600">
          <Totals totals={totals} paid={info.posts && doc.type !== 'expense' ? paid : undefined} due={info.posts && doc.type !== 'expense' && !info.credit && doc.status === 'posted' ? totals.total - paid : undefined} />
        </div>
        {doc.taxInclusive && showTax && <p className="mt-2 text-right text-xs text-gray-500">Prices include {company.taxName}.</p>}

        {pay && (
          <section className="mt-8 flex flex-col gap-4 rounded-xl border border-gray-200 p-4 sm:flex-row sm:items-center print:break-inside-avoid">
            {pay.showQr && <QrCode value={pay.upi?.url ?? pay.link!} size={112} label={pay.upi ? 'UPI payment QR code' : 'Payment link QR code'} className="shrink-0" />}
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-wider text-gray-500 uppercase">Pay online</p>
              <p className="mt-1 text-gray-700">
                {pay.upi ? `Scan with any UPI app to pay ${f.money(due)}${pay.link ? ', or use the link below' : ''}.` : `Scan the code or use the link to pay ${f.money(due)}.`}
              </p>
              {pay.upi && <p className="mt-1 text-gray-600">UPI ID: <span className="font-medium text-gray-900">{pay.upi.id}</span></p>}
              {pay.link && (
                <a href={pay.link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-medium break-all" style={{ color: accent }}>
                  <span className="print:hidden">Pay {f.money(due)} online →</span>
                  <span className="hidden print:inline">{pay.link}</span>
                </a>
              )}
            </div>
          </section>
        )}

        {(doc.notes || doc.terms || (info.side === 'sales' && settings.bankDetails)) && (
          <section className="mt-8 grid grid-cols-1 gap-6 border-t border-gray-200 pt-6 sm:grid-cols-2">
            {doc.notes && (
              <div>
                <p className="mb-1 text-[11px] font-semibold tracking-wider text-gray-500 uppercase">Notes</p>
                <p className="whitespace-pre-line text-gray-700">{doc.notes}</p>
              </div>
            )}
            {info.side === 'sales' && settings.bankDetails && doc.type !== 'credit_note' && (
              <div>
                <p className="mb-1 text-[11px] font-semibold tracking-wider text-gray-500 uppercase">How to pay</p>
                <p className="whitespace-pre-line text-gray-700">{settings.bankDetails}</p>
              </div>
            )}
            {doc.terms && (
              <div className="sm:col-span-2">
                <p className="mb-1 text-[11px] font-semibold tracking-wider text-gray-500 uppercase">Terms & conditions</p>
                <p className="whitespace-pre-line text-gray-600">{doc.terms}</p>
              </div>
            )}
          </section>
        )}
      </div>
    </article>
  )
}

function ShareMenu({ doc, contact, due, onRemind }: { doc: Doc; contact?: Contact; due: number; onRemind?: () => void }) {
  const company = useCompany()
  const f = useFormat()
  const toast = useToast()
  const info = DOC_TYPES[doc.type]
  if (info.side !== 'sales' && doc.type !== 'purchase_order') return null
  const bank = doc.status === 'posted' || doc.status === 'draft' ? howToPay(company, doc, due) : ''
  const payLink = payOptions(company, doc, due)?.link
  const text = [
    `Hello${contact ? ` ${contact.contactPerson ?? contact.name}` : ''},`,
    '',
    `${info.label} ${doc.number} from ${company.name} for ${f.money(doc.total)}${doc.dueDate && info.dueLabel ? ` (${info.dueLabel.toLowerCase()} ${f.date(doc.dueDate)})` : ''}.`,
    doc.type === 'invoice' && due > 0 && due !== doc.total ? `Balance due: ${f.money(due)}.` : '',
    doc.type === 'invoice' && bank ? `\nHow to pay:\n${bank}` : '',
    '',
    'Thank you!',
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n')
  const phone = contact?.phone?.replace(/[^\d]/g, '')

  return (
    <Menu
      align="end"
      trigger={({ toggle }) => (
        <Button icon={<Share2 />} onClick={toggle}>
          Share
        </Button>
      )}
    >
      {(close) => (
        <>
          <MenuItem icon={<MessageCircle />} onClick={() => (close(), window.open(`https://wa.me/${phone ?? ''}?text=${encodeURIComponent(text)}`, '_blank', 'noopener'))}>
            WhatsApp
          </MenuItem>
          <MenuItem
            icon={<Mail />}
            onClick={() => (close(), (window.location.href = `mailto:${contact?.email ?? ''}?subject=${encodeURIComponent(`${info.label} ${doc.number} from ${company.name}`)}&body=${encodeURIComponent(text)}`))}
          >
            Email
          </MenuItem>
          <MenuItem
            icon={<Copy />}
            onClick={async () => {
              close()
              try {
                await navigator.clipboard.writeText(text)
                toast('Message copied')
              } catch {
                toast("Couldn't copy on this device", 'error')
              }
            }}
          >
            Copy message
          </MenuItem>
          <MenuItem icon={<Printer />} onClick={() => (close(), window.print())}>
            Save as PDF
          </MenuItem>
          {payLink && (
            <MenuItem
              icon={<Link2 />}
              onClick={async () => {
                close()
                try {
                  await navigator.clipboard.writeText(payLink)
                  toast('Payment link copied')
                } catch {
                  toast("Couldn't copy on this device", 'error')
                }
              }}
            >
              Copy payment link
            </MenuItem>
          )}
          {onRemind && (
            <MenuItem icon={<BellRing />} onClick={() => (close(), onRemind())}>
              Send payment reminder
            </MenuItem>
          )}
        </>
      )}
    </Menu>
  )
}

function ApplyCreditDialog({ credit, docs, settled, onClose }: { credit: Doc; docs: Doc[]; settled: Map<string, number>; onClose: () => void }) {
  const f = useFormat()
  const toast = useToast()
  const target = SETTLES[credit.type]!
  const current = new Map((credit.allocations ?? []).map((a) => [a.documentId, a.amount]))
  const open = docs
    .filter((d) => d.type === target && d.status === 'posted' && d.contactId === credit.contactId)
    .map((d) => ({ doc: d, due: d.total - (settled.get(d.id) ?? 0) + (current.get(d.id) ?? 0) }))
    .filter((x) => x.due > 0)
    .sort((a, b) => a.doc.date.localeCompare(b.doc.date))
  const [amounts, setAmounts] = useState<Record<string, number>>(Object.fromEntries(current))
  const [error, setError] = useState<string | null>(null)
  const used = Object.values(amounts).reduce((s, v) => s + v, 0)

  const save = async () => {
    try {
      const allocations: Allocation[] = Object.entries(amounts).map(([documentId, amount]) => ({ documentId, amount }))
      await applyCredit(db, credit.id, allocations)
      toast('Credit applied')
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Apply ${DOC_TYPES[credit.type].label.toLowerCase()} ${credit.number}`}
      description={`${f.money(credit.total)} credit · ${f.money(credit.total - used)} left after this`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={used > credit.total}>
            Apply
          </Button>
        </>
      }
    >
      {open.length === 0 ? (
        <p className="text-sm text-fg-muted">There are no open {DOC_TYPES[target].plural.toLowerCase()} for this contact.</p>
      ) : (
        <ul className="divide-y divide-line">
          {open.map(({ doc, due }) => (
            <li key={doc.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">{doc.number}</p>
                <p className="text-xs text-fg-subtle">
                  {f.date(doc.date)} · {f.money(due)} due
                </p>
              </div>
              <AmountInput value={amounts[doc.id] ?? 0} onChange={(v) => setAmounts((m) => ({ ...m, [doc.id]: Math.min(v, due) }))} className="w-36" aria-label={`Amount for ${doc.number}`} />
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Dialog>
  )
}
