import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { computeTotals, DOC_TYPES, lineGross, saveDocument, type DocInput } from '../../accounting/documents'
import { errorMessage } from '../../accounting/errors'
import { AccountPicker } from '../../components/AccountPicker'
import { AmountInput } from '../../components/AmountInput'
import { Attachments } from '../../components/Attachments'
import { Combobox } from '../../components/Combobox'
import { TERMS_OPTIONS } from '../../components/ContactDialog'
import { ContactPicker } from '../../components/ContactPicker'
import { Button } from '../../components/ui/button'
import { Field, Input, inputClass, Select, Switch, Textarea } from '../../components/ui/form'
import { Card, Help, PageHeader, Spinner } from '../../components/ui/misc'
import { useToast } from '../../components/ui/toast'
import { db } from '../../db'
import type { Doc, DocStatus, DocType, Item } from '../../db/types'
import { cn } from '../../lib/cn'
import { addDays, today } from '../../lib/dates'
import { newId } from '../../lib/id'
import { useCompany, useFormat } from '../../state/company'
import { useAccounts, useContacts, useItems, useTaxRates } from '../../state/data'
import { usePrefs } from '../../state/prefs'

interface Row {
  id: string
  itemId: string
  description: string
  quantity: number
  qtyText: string
  rate: number
  discountPct: number
  accountId: string
  taxRateId: string
  more: boolean
}

interface FormState {
  contactId: string
  number: string
  date: string
  dueDate: string
  termsDays: number | 'custom'
  reference: string
  taxInclusive: boolean
  notes: string
  terms: string
  paidFromAccountId: string
  rows: Row[]
}

const MONEY_SUBTYPES = new Set(['cash', 'bank', 'credit_card'])

function defaultTerms(type: DocType, settings: { paymentTermsDays?: number; quoteValidityDays?: number } | undefined): number {
  if (type === 'quote') return settings?.quoteValidityDays ?? 14
  if (type === 'purchase_order') return 7
  if (type === 'bill') return 30
  return settings?.paymentTermsDays ?? 14
}

export function DocumentForm({ type }: { type: DocType }) {
  const info = DOC_TYPES[type]
  const { id } = useParams()
  const [params] = useSearchParams()
  const company = useCompany()
  const f = useFormat()
  const { mode } = usePrefs()
  const toast = useToast()
  const navigate = useNavigate()
  const accounts = useAccounts(company.id)
  const taxRates = useTaxRates(company.id)
  const items = useItems(company.id)
  const contacts = useContacts(company.id)
  const existing = useLiveQuery(async () => (id ? ((await db.documents.get(id)) ?? null) : null), [id])
  const [draftId] = useState(newId)
  const [form, setForm] = useState<FormState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

  const sales = info.side === 'sales'
  const defaultAccount = useMemo(() => (sales ? (accounts?.find((a) => a.systemKey === 'sales')?.id ?? '') : ''), [accounts, sales])
  const blankRow = (): Row => ({ id: newId(), itemId: '', description: '', quantity: 1, qtyText: '1', rate: 0, discountPct: 0, accountId: defaultAccount, taxRateId: '', more: false })

  useEffect(() => {
    if (form || !accounts || !contacts || existing === undefined) return
    if (existing) {
      setForm(fromDoc(existing))
      setShowNotes(!!existing.notes || !!existing.terms)
      return
    }
    const contactId = params.get('contact') ?? ''
    const contact = contacts.find((c) => c.id === contactId)
    const termsDays = contact?.paymentTermsDays ?? defaultTerms(type, company.documentSettings)
    const date = today()
    const settings = company.documentSettings
    setForm({
      contactId,
      number: '',
      date,
      dueDate: addDays(date, termsDays),
      termsDays: TERMS_OPTIONS.some((t) => t.value === termsDays) ? termsDays : 'custom',
      reference: '',
      taxInclusive: false,
      notes: sales ? (settings?.invoiceNotes ?? '') : '',
      terms: sales ? (settings?.invoiceTerms ?? '') : '',
      paidFromAccountId: accounts.find((a) => a.systemKey === 'bank')?.id ?? '',
      rows: [blankRow()],
    })
    // Initialise once, when the data first arrives; later live updates must not wipe the form.
  }, [accounts, contacts, existing])

  const taxMap = useMemo(() => new Map((taxRates ?? []).map((t) => [t.id, t])), [taxRates])
  const totals = useMemo(
    () => (form ? computeTotals(form.rows.map((r) => ({ id: r.id, quantity: r.quantity, rate: r.rate, discountPct: r.discountPct, taxRateId: r.taxRateId || undefined })), taxMap, form.taxInclusive, info.side) : null),
    [form, taxMap, info.side],
  )

  if (!form || !accounts || !items || !taxRates || !totals) return <Spinner />
  if (existing && (existing.status === 'void' || existing.status === 'converted')) {
    return (
      <Card className="p-6 text-sm text-fg-muted">
        This {info.label.toLowerCase()} is {existing.status} and can't be edited.{' '}
        <Link to={`${info.path}/${existing.id}`} className="font-medium text-primary-ink">
          View it
        </Link>
      </Card>
    )
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((s) => (s ? { ...s, [k]: v } : s))
  const setRow = (rid: string, patch: Partial<Row>) => setForm((s) => (s ? { ...s, rows: s.rows.map((r) => (r.id === rid ? { ...r, ...patch } : r)) } : s))
  const applyTerms = (days: number | 'custom', date = form.date) => setForm((s) => (s ? { ...s, termsDays: days, dueDate: days === 'custom' ? s.dueDate : addDays(date, days) } : s))

  const chooseItem = (rid: string, item: Item | undefined) => {
    if (!item) return setRow(rid, { itemId: '' })
    setRow(rid, {
      itemId: item.id,
      description: item.description ? `${item.name} — ${item.description}` : item.name,
      rate: sales ? item.salePrice : item.purchasePrice,
      accountId: (sales ? item.salesAccountId : item.trackStock ? item.inventoryAccountId : item.purchaseAccountId) ?? (sales ? defaultAccount : ''),
      taxRateId: (sales ? item.salesTaxRateId : item.purchaseTaxRateId) ?? '',
    })
  }

  const lineAccounts = accounts.filter((a) => (sales ? a.type === 'income' : a.type === 'expense' || (a.type === 'asset' && !MONEY_SUBTYPES.has(a.subtype) && a.subtype !== 'receivable')))
  const moneyAccounts = accounts.filter((a) => MONEY_SUBTYPES.has(a.subtype))
  const itemOptions = items
    .filter((i) => !i.archived)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => ({ id: i.id, label: i.name, hint: f.money(sales ? i.salePrice : i.purchasePrice) }))
  const activeRates = taxRates.filter((t) => !t.archived).sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name))
  const nextNumber = `${info.prefix}-${String(company.nextNumbers[type] ?? 1).padStart(4, '0')}`

  const save = async (opts: { post?: boolean; status?: DocStatus }) => {
    setBusy(true)
    setError(null)
    const input: DocInput = {
      type,
      number: form.number.trim() || undefined,
      contactId: form.contactId || undefined,
      date: form.date,
      dueDate: info.dueLabel ? form.dueDate : undefined,
      reference: form.reference,
      lines: form.rows.map((r) => ({
        id: r.id,
        itemId: r.itemId || undefined,
        description: r.description,
        quantity: r.quantity,
        rate: r.rate,
        discountPct: r.discountPct || undefined,
        accountId: r.accountId,
        taxRateId: r.taxRateId || undefined,
      })),
      taxInclusive: form.taxInclusive,
      notes: form.notes,
      terms: form.terms,
      paidFromAccountId: type === 'expense' ? form.paidFromAccountId : undefined,
    }
    try {
      const doc = await saveDocument(db, company.id, input, { id: existing?.id, ...opts, assignId: existing ? undefined : draftId })
      toast(`${info.label} ${doc.number} saved`)
      navigate(`${info.path}/${doc.id}`, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const submitPrimary = (e?: FormEvent) => {
    e?.preventDefault()
    if (info.posts) void save({ post: true })
    else void save({ status: existing && existing.status !== 'draft' ? existing.status : type === 'quote' ? 'sent' : 'issued' })
  }

  const isPosted = existing?.status === 'posted'
  const primaryLabel = info.posts
    ? isPosted
      ? 'Save changes'
      : type === 'expense'
        ? 'Save expense'
        : `Save ${info.label.toLowerCase()}`
    : existing && existing.status !== 'draft'
      ? 'Save changes'
      : type === 'quote'
        ? 'Save & mark as sent'
        : 'Save & issue'
  const showDraft = type !== 'expense' && (!existing || existing.status === 'draft')

  const gridCols = sales
    ? 'md:grid-cols-[minmax(0,3fr)_5rem_8rem_9rem_8rem_2.25rem]'
    : 'md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.8fr)_5rem_8rem_9rem_8rem_2.25rem]'

  return (
    <div>
      <PageHeader
        back={
          <Link to={existing ? `${info.path}/${existing.id}` : info.path} className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> {existing ? `${info.label} ${existing.number}` : info.plural}
          </Link>
        }
        title={existing ? `Edit ${info.label.toLowerCase()} ${existing.number}` : `New ${info.label.toLowerCase()}`}
        description={isPosted ? 'Saving replaces the original entry in your books with the corrected one. The history is kept.' : undefined}
      />

      <form onSubmit={submitPrimary}>
        <Card className="p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={type === 'expense' ? 'Supplier (optional)' : info.contactLabel} className="sm:col-span-2">
              {(fid) => (
                <ContactPicker
                  id={fid}
                  type={sales ? 'customer' : 'supplier'}
                  value={form.contactId}
                  onChange={(cid) => {
                    set('contactId', cid)
                    const c = contacts?.find((x) => x.id === cid)
                    if (c?.paymentTermsDays !== undefined && info.dueLabel && form.termsDays !== 'custom') applyTerms(TERMS_OPTIONS.some((t) => t.value === c.paymentTermsDays) ? c.paymentTermsDays : 'custom')
                  }}
                />
              )}
            </Field>
            <Field label={`${info.label} number`}>{(fid) => <Input id={fid} value={form.number} onChange={(e) => set('number', e.target.value)} placeholder={existing?.number ?? nextNumber} maxLength={40} />}</Field>
            <Field label="Date">
              {(fid) => (
                <Input
                  id={fid}
                  type="date"
                  value={form.date}
                  required
                  onChange={(e) => {
                    const date = e.target.value
                    setForm((s) => (s ? { ...s, date, dueDate: s.termsDays === 'custom' ? s.dueDate : addDays(date || s.date, s.termsDays) } : s))
                  }}
                />
              )}
            </Field>
            {info.dueLabel && (
              <>
                <Field label={type === 'quote' ? 'Valid for' : type === 'purchase_order' ? 'Delivery in' : 'Payment terms'}>
                  {(fid) => (
                    <Select id={fid} value={form.termsDays} onChange={(e) => applyTerms(e.target.value === 'custom' ? 'custom' : Number(e.target.value))}>
                      {(type === 'quote' || type === 'purchase_order'
                        ? [7, 14, 30, 60].map((d) => ({ value: d, label: `${d} days` }))
                        : TERMS_OPTIONS
                      ).map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                      <option value="custom">Pick a date</option>
                    </Select>
                  )}
                </Field>
                <Field label={info.dueLabel}>
                  {(fid) => <Input id={fid} type="date" value={form.dueDate} min={form.date} onChange={(e) => (set('dueDate', e.target.value), set('termsDays', 'custom'))} />}
                </Field>
              </>
            )}
            {type === 'expense' && (
              <Field label="Paid from" className="sm:col-span-2">
                {(fid) => (
                  <AccountPicker id={fid} accounts={moneyAccounts} value={form.paidFromAccountId} onChange={(v) => set('paidFromAccountId', v)} showCodes={mode === 'accountant'} groupOrder={['asset', 'liability']} />
                )}
              </Field>
            )}
            <Field label={sales ? 'Reference' : type === 'expense' ? 'Receipt number' : "Supplier's invoice number"} className={type === 'expense' ? 'sm:col-span-2' : 'sm:col-span-2'} hint={sales ? 'Optional, e.g. the customer’s order number.' : undefined}>
              {(fid, d) => <Input id={fid} aria-describedby={d} value={form.reference} onChange={(e) => set('reference', e.target.value)} maxLength={60} />}
            </Field>
          </div>
        </Card>

        <Card className="mt-4">
          <div className={cn('hidden gap-3 border-b border-line px-5 py-2.5 text-xs font-medium text-fg-subtle md:grid', gridCols)}>
            <span>Item or description</span>
            {!sales && <span>Category</span>}
            <span className="text-right">Qty</span>
            <span className="text-right">Price</span>
            <span>Tax</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          <div className="divide-y divide-line">
            {form.rows.map((row, i) => (
              <div key={row.id} className="px-5 py-3">
                <div className={cn('grid grid-cols-2 gap-3 md:items-center', gridCols)}>
                  <Combobox
                    className="col-span-2 md:col-span-1"
                    aria-label={`Line ${i + 1} item or description`}
                    options={itemOptions}
                    value={row.itemId}
                    onChange={(itemId) => chooseItem(row.id, items.find((it) => it.id === itemId))}
                    freeText={{ value: row.description, onChange: (description) => setRow(row.id, { description }) }}
                    placeholder={items.length ? 'Type a description or pick an item' : 'What did you sell or buy?'}
                  />
                  {!sales && (
                    <AccountPicker
                      className="col-span-2 md:col-span-1"
                      aria-label={`Line ${i + 1} category`}
                      accounts={lineAccounts}
                      value={row.accountId}
                      onChange={(accountId) => setRow(row.id, { accountId })}
                      showCodes={mode === 'accountant'}
                      groupOrder={['expense', 'asset']}
                      placeholder="Category, e.g. Rent"
                    />
                  )}
                  <label className="flex flex-col gap-1 md:block">
                    <span className="text-xs text-fg-subtle md:sr-only">Quantity</span>
                    <input
                      inputMode="decimal"
                      aria-label={`Line ${i + 1} quantity`}
                      value={row.qtyText}
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(/,/g, ''))
                        setRow(row.id, { qtyText: e.target.value, quantity: Number.isFinite(n) ? n : 0 })
                      }}
                      onFocus={(e) => e.target.select()}
                      className={cn(inputClass, 'text-right tabular-nums')}
                    />
                  </label>
                  <label className="flex flex-col gap-1 md:block">
                    <span className="text-xs text-fg-subtle md:sr-only">Price</span>
                    <AmountInput value={row.rate} onChange={(rate) => setRow(row.id, { rate })} aria-label={`Line ${i + 1} price`} />
                  </label>
                  <label className="flex flex-col gap-1 md:block">
                    <span className="text-xs text-fg-subtle md:sr-only">Tax</span>
                    <Select aria-label={`Line ${i + 1} tax`} value={row.taxRateId} onChange={(e) => setRow(row.id, { taxRateId: e.target.value })}>
                      <option value="">No tax</option>
                      {activeRates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <div className="flex items-center justify-between text-sm font-semibold tabular-nums md:block md:text-right">
                    <span className="text-xs font-normal text-fg-subtle md:hidden">Amount</span>
                    {f.money(lineGross(row))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm((s) => (s ? { ...s, rows: s.rows.length > 1 ? s.rows.filter((r) => r.id !== row.id) : [blankRow()] } : s))}
                    aria-label={`Remove line ${i + 1}`}
                    className="col-span-2 grid h-9 place-items-center rounded-lg text-fg-subtle hover:bg-danger-soft hover:text-danger md:col-span-1 md:size-9"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {row.more ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl bg-surface-2/60 p-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                    {sales ? (
                      <Field label="Income account">
                        {(fid) => <AccountPicker id={fid} accounts={lineAccounts} value={row.accountId} onChange={(accountId) => setRow(row.id, { accountId })} showCodes={mode === 'accountant'} groupOrder={['income']} />}
                      </Field>
                    ) : (
                      <span />
                    )}
                    <Field label="Discount %">
                      {(fid) => (
                        <Input
                          id={fid}
                          inputMode="decimal"
                          value={row.discountPct || ''}
                          placeholder="0"
                          onChange={(e) => setRow(row.id, { discountPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                          className="text-right tabular-nums"
                        />
                      )}
                    </Field>
                  </div>
                ) : (
                  <button type="button" onClick={() => setRow(row.id, { more: true })} className="mt-1.5 inline-flex items-center gap-1 text-xs text-fg-subtle hover:text-fg">
                    <ChevronDown className="size-3" />
                    {sales ? `${accounts.find((a) => a.id === row.accountId)?.name ?? 'Choose income account'}${row.discountPct ? ` · ${row.discountPct}% off` : ''} · Discount` : row.discountPct ? `${row.discountPct}% off` : 'Add discount'}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-4 border-t border-line px-5 py-4 md:flex-row md:items-start md:justify-between">
            <div className="flex flex-col gap-3">
              <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setForm((s) => (s ? { ...s, rows: [...s.rows, blankRow()] } : s))} className="self-start">
                Add line
              </Button>
              <Switch
                checked={form.taxInclusive}
                onChange={(v) => set('taxInclusive', v)}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    Prices include tax <Help>Turn on if the prices you typed already include {company.taxName}. The tax is worked out from inside the price.</Help>
                  </span>
                }
              />
            </div>
            <Totals totals={totals} />
          </div>
        </Card>

        <Card className="mt-4 p-5">
          {showNotes || type === 'expense' ? null : (
            <button type="button" onClick={() => setShowNotes(true)} className="text-sm font-medium text-primary-ink hover:underline">
              + Add notes{sales ? ' and terms' : ''}
            </button>
          )}
          {(showNotes || type === 'expense') && (
            <div className={cn('grid grid-cols-1 gap-4', sales && 'md:grid-cols-2')}>
              <Field label={sales ? 'Note to customer' : 'Notes'}>{(fid) => <Textarea id={fid} value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} maxLength={2000} />}</Field>
              {sales && <Field label="Terms & conditions">{(fid) => <Textarea id={fid} value={form.terms} onChange={(e) => set('terms', e.target.value)} rows={3} maxLength={2000} />}</Field>}
            </div>
          )}
          <div className="mt-5 border-t border-line pt-4">
            <p className="mb-2 text-[13px] font-medium">Attachments</p>
            <Attachments parentId={existing?.id ?? draftId} />
          </div>
        </Card>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={() => navigate(-1)}>Cancel</Button>
          {showDraft && (
            <Button onClick={() => void save({ post: false, status: 'draft' })} disabled={busy}>
              Save as draft
            </Button>
          )}
          <Button variant="primary" type="submit" size="lg" disabled={busy}>
            {primaryLabel}
          </Button>
        </div>
      </form>
    </div>
  )

  function fromDoc(doc: Doc): FormState {
    return {
      contactId: doc.contactId ?? '',
      number: doc.number,
      date: doc.date,
      dueDate: doc.dueDate ?? doc.date,
      termsDays: 'custom',
      reference: doc.reference ?? '',
      taxInclusive: doc.taxInclusive,
      notes: doc.notes ?? '',
      terms: doc.terms ?? '',
      paidFromAccountId: doc.paidFromAccountId ?? '',
      rows: doc.lines.map((l) => ({
        id: l.id,
        itemId: l.itemId ?? '',
        description: l.description,
        quantity: l.quantity,
        qtyText: String(l.quantity),
        rate: l.rate,
        discountPct: l.discountPct ?? 0,
        accountId: l.accountId,
        taxRateId: l.taxRateId ?? '',
        more: false,
      })),
    }
  }
}

export function Totals({ totals, due, paid }: { totals: { subtotal: number; taxes: { key: string; name: string; rate: number; amount: number }[]; total: number }; paid?: number; due?: number }) {
  const f = useFormat()
  return (
    <dl className="w-full space-y-1.5 text-sm md:w-72">
      <div className="flex justify-between text-fg-muted">
        <dt>Subtotal</dt>
        <dd className="tabular-nums">{f.money(totals.subtotal)}</dd>
      </div>
      {totals.taxes.map((t) => (
        <div key={t.key} className="flex justify-between text-fg-muted">
          <dt>
            {t.name} {t.rate}%
          </dt>
          <dd className="tabular-nums">{f.money(t.amount)}</dd>
        </div>
      ))}
      <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
        <dt>Total</dt>
        <dd className="tabular-nums">{f.money(totals.total)}</dd>
      </div>
      {paid !== undefined && paid > 0 && (
        <div className="flex justify-between text-fg-muted">
          <dt>Paid</dt>
          <dd className="tabular-nums">−{f.money(paid)}</dd>
        </div>
      )}
      {due !== undefined && (
        <div className="flex justify-between font-semibold">
          <dt>Balance due</dt>
          <dd className="tabular-nums">{f.money(due)}</dd>
        </div>
      )}
    </dl>
  )
}

