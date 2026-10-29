import { Archive, ArchiveRestore, ArrowLeft, Boxes, Package, Pencil, Plus, Search, SlidersHorizontal, Trash2, Wrench } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { errorMessage } from '../accounting/errors'
import { adjustStock, deleteItem, roundQty, saveItem, setItemArchived, stockLevels } from '../accounting/items'
import { AccountPicker } from '../components/AccountPicker'
import { AmountInput } from '../components/AmountInput'
import { Button } from '../components/ui/button'
import { ConfirmDialog, Dialog } from '../components/ui/dialog'
import { Field, Input, Select, Switch, Textarea } from '../components/ui/form'
import { Badge, Card, EmptyState, PageHeader, Segmented, Spinner } from '../components/ui/misc'
import { useToast } from '../components/ui/toast'
import { db } from '../db'
import type { Item } from '../db/types'
import { cn } from '../lib/cn'
import { today } from '../lib/dates'
import { useCompany, useFormat } from '../state/company'
import { useAccounts, useItems, useStockMoves, useTaxRates } from '../state/data'
import { usePrefs } from '../state/prefs'

export function ItemsList() {
  const company = useCompany()
  const f = useFormat()
  const navigate = useNavigate()
  const items = useItems(company.id)
  const moves = useStockMoves(company.id)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'product' | 'service' | 'low'>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const levels = useMemo(() => stockLevels(moves ?? []), [moves])

  if (!items || !moves) return <Spinner />
  const q = query.trim().toLowerCase()
  const isLow = (i: Item) => i.trackStock && i.reorderLevel !== undefined && (levels.get(i.id)?.quantity ?? 0) <= i.reorderLevel
  const visible = items
    .filter((i) => showArchived || !i.archived)
    .filter((i) => filter === 'all' || (filter === 'low' ? isLow(i) : i.kind === filter))
    .filter((i) => !q || i.name.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
  const lowCount = items.filter((i) => !i.archived && isLow(i)).length

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:px-0">
          <Segmented
            label="Filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'product', label: 'Products' },
              { value: 'service', label: 'Services' },
              ...(company.features.inventory ? [{ value: 'low' as const, label: `Low stock${lowCount ? ` (${lowCount})` : ''}` }] : []),
            ]}
          />
        </div>
        <div className="relative lg:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or SKU" aria-label="Search items" className="pl-9" />
        </div>
        <Switch checked={showArchived} onChange={setShowArchived} label="Show archived" />
        <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)} className="lg:ml-auto">
          New item
        </Button>
      </div>
      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState
            icon={<Package />}
            title={items.length ? 'No items match' : 'No products or services yet'}
            description={items.length ? 'Try a different filter.' : 'Save what you sell or buy with its price and tax, then add it to invoices in one click.'}
            action={!items.length && <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>New item</Button>}
          />
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1fr)_8rem_8rem_9rem] gap-3 border-b border-line px-5 py-2.5 text-xs font-medium text-fg-subtle md:grid">
              <span>Item</span>
              <span className="text-right">Selling price</span>
              <span className="text-right">Cost</span>
              <span className="text-right">In stock</span>
            </div>
            <ul className="divide-y divide-line">
              {visible.map((i) => {
                const level = levels.get(i.id)
                return (
                  <li key={i.id}>
                    <Link to={`/items/${i.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 hover:bg-surface-2/60 md:grid-cols-[minmax(0,1fr)_8rem_8rem_9rem]">
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-muted">{i.kind === 'service' ? <Wrench className="size-4" /> : <Package className="size-4" />}</span>
                        <span className="min-w-0">
                          <span className={cn('flex items-center gap-2 text-sm font-medium', i.archived && 'text-fg-subtle')}>
                            <span className="truncate">{i.name}</span>
                            {i.archived && <Badge>Archived</Badge>}
                            {isLow(i) && <Badge tone="warning">Low stock</Badge>}
                          </span>
                          <span className="block truncate text-xs text-fg-subtle">{[i.sku, i.kind === 'service' ? 'Service' : 'Product'].filter(Boolean).join(' · ')}</span>
                        </span>
                      </span>
                      <span className="text-right text-sm tabular-nums">{f.money(i.salePrice)}</span>
                      <span className="text-right text-sm text-fg-muted tabular-nums max-md:hidden">{f.money(i.purchasePrice)}</span>
                      <span className="text-right text-sm tabular-nums max-md:hidden">{i.trackStock ? `${level?.quantity ?? 0} ${i.unit ?? ''}` : '—'}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Card>
      <ItemDialog open={creating} onClose={() => setCreating(false)} onSaved={(i) => navigate(`/items/${i.id}`)} />
    </div>
  )
}

export function ItemDialog({ open, onClose, item, onSaved }: { open: boolean; onClose: () => void; item?: Item; onSaved?: (i: Item) => void }) {
  const company = useCompany()
  const { mode } = usePrefs()
  const toast = useToast()
  const accounts = useAccounts(company.id) ?? []
  const taxRates = (useTaxRates(company.id) ?? []).filter((t) => !t.archived)
  const blank = {
    kind: 'product' as Item['kind'],
    name: '',
    sku: '',
    unit: '',
    description: '',
    salePrice: 0,
    purchasePrice: 0,
    salesAccountId: '',
    purchaseAccountId: '',
    salesTaxRateId: '',
    purchaseTaxRateId: '',
    trackStock: false,
    reorderLevel: '' as number | '',
  }
  const [form, setForm] = useState(blank)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setForm(
      item
        ? {
            kind: item.kind,
            name: item.name,
            sku: item.sku ?? '',
            unit: item.unit ?? '',
            description: item.description ?? '',
            salePrice: item.salePrice,
            purchasePrice: item.purchasePrice,
            salesAccountId: item.salesAccountId ?? '',
            purchaseAccountId: item.purchaseAccountId ?? '',
            salesTaxRateId: item.salesTaxRateId ?? '',
            purchaseTaxRateId: item.purchaseTaxRateId ?? '',
            trackStock: item.trackStock,
            reorderLevel: item.reorderLevel ?? '',
          }
        : { ...blank, salesAccountId: accounts.find((a) => a.systemKey === 'sales')?.id ?? '', trackStock: company.features.inventory },
    )
    // Reset only when opening or switching item.
  }, [open, item?.id])

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((s) => ({ ...s, [k]: v }))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const saved = await saveItem(db, company.id, { ...form, trackStock: form.kind === 'product' && form.trackStock, reorderLevel: form.reorderLevel === '' ? undefined : form.reorderLevel }, item?.id)
      toast(item ? 'Item updated' : `Added ${saved.name}`)
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const showCodes = mode === 'accountant'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={item ? `Edit ${item.name}` : 'New item'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="item-form" disabled={busy}>
            {item ? 'Save changes' : 'Add item'}
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={submit} className="flex flex-col gap-4">
        <Segmented
          label="Item type"
          value={form.kind}
          onChange={(v) => set('kind', v)}
          className="w-full [&>button]:flex-1"
          options={[
            { value: 'product', label: 'Product (goods)' },
            { value: 'service', label: 'Service (work, time)' },
          ]}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_9rem_7rem]">
          <Field label="Name">{(id) => <Input id={id} value={form.name} onChange={(e) => set('name', e.target.value)} data-autofocus maxLength={150} required />}</Field>
          <Field label="SKU / code">{(id) => <Input id={id} value={form.sku} onChange={(e) => set('sku', e.target.value)} maxLength={40} />}</Field>
          <Field label="Unit">{(id) => <Input id={id} value={form.unit} onChange={(e) => set('unit', e.target.value)} placeholder={form.kind === 'service' ? 'hour' : 'pcs'} maxLength={20} />}</Field>
        </div>
        <Field label="Description" hint="Shown on invoices under the name.">
          {(id, d) => <Textarea id={id} aria-describedby={d} value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} maxLength={500} />}
        </Field>
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-line p-4 sm:grid-cols-3">
          <p className="text-sm font-semibold sm:col-span-3">Selling</p>
          <Field label="Price">{(id) => <AmountInput id={id} value={form.salePrice} onChange={(v) => set('salePrice', v)} />}</Field>
          <Field label="Income account">
            {(id) => <AccountPicker id={id} accounts={accounts.filter((a) => a.type === 'income')} value={form.salesAccountId} onChange={(v) => set('salesAccountId', v)} showCodes={showCodes} groupOrder={['income']} />}
          </Field>
          <Field label="Tax">
            {(id) => (
              <Select id={id} value={form.salesTaxRateId} onChange={(e) => set('salesTaxRateId', e.target.value)}>
                <option value="">No tax</option>
                {taxRates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-line p-4 sm:grid-cols-3">
          <p className="text-sm font-semibold sm:col-span-3">Buying</p>
          <Field label="Cost">{(id) => <AmountInput id={id} value={form.purchasePrice} onChange={(v) => set('purchasePrice', v)} />}</Field>
          {!(form.kind === 'product' && form.trackStock) ? (
            <Field label="Expense account">
              {(id) => (
                <AccountPicker id={id} accounts={accounts.filter((a) => a.type === 'expense' || a.subtype === 'fixed_asset')} value={form.purchaseAccountId} onChange={(v) => set('purchaseAccountId', v)} showCodes={showCodes} groupOrder={['expense', 'asset']} />
              )}
            </Field>
          ) : (
            <Field label="Bought into" hint="Stock is held as an asset until it's sold.">
              {(id, d) => <Input id={id} aria-describedby={d} value="Inventory" disabled />}
            </Field>
          )}
          <Field label="Tax">
            {(id) => (
              <Select id={id} value={form.purchaseTaxRateId} onChange={(e) => set('purchaseTaxRateId', e.target.value)}>
                <option value="">No tax</option>
                {taxRates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {form.kind === 'product' && (
          <div className="flex flex-col gap-4 rounded-xl border border-line p-4">
            <Switch
              checked={form.trackStock}
              onChange={(v) => set('trackStock', v)}
              disabled={!company.features.inventory}
              label="Track stock"
              description={company.features.inventory ? 'Count units in and out, and value them at average cost.' : 'Turn on inventory in Settings → Business first.'}
            />
            {form.trackStock && (
              <Field label="Alert me when stock falls to" className="sm:w-56">
                {(id) => <Input id={id} inputMode="decimal" value={form.reorderLevel} onChange={(e) => set('reorderLevel', e.target.value === '' ? '' : Number(e.target.value) || 0)} placeholder="e.g. 10" />}
              </Field>
            )}
          </div>
        )}
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </form>
    </Dialog>
  )
}

export function ItemView() {
  const { id = '' } = useParams()
  const company = useCompany()
  const f = useFormat()
  const toast = useToast()
  const navigate = useNavigate()
  const items = useItems(company.id)
  const moves = useStockMoves(company.id)
  const [editing, setEditing] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (!items || !moves) return <Spinner />
  const item = items.find((i) => i.id === id)
  if (!item) return <Card><EmptyState title="Item not found" action={<Link to="/items" className="text-sm font-medium text-primary-ink">Back to items</Link>} /></Card>
  const mine = moves.filter((m) => m.itemId === item.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
  const level = stockLevels(mine).get(item.id) ?? { quantity: 0, value: 0, averageCost: 0 }

  return (
    <div>
      <PageHeader
        back={
          <Link to="/items" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> Items
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {item.name} {item.archived && <Badge>Archived</Badge>}
          </span>
        }
        description={[item.sku, item.kind === 'service' ? 'Service' : 'Product', item.description].filter(Boolean).join(' · ')}
        actions={
          <>
            {item.trackStock && (
              <Button icon={<SlidersHorizontal />} onClick={() => setAdjusting(true)}>
                Adjust stock
              </Button>
            )}
            <Button icon={<Pencil />} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="icon" variant="ghost" aria-label={item.archived ? 'Restore' : 'Archive'} onClick={() => void setItemArchived(db, item.id, !item.archived)}>
              {item.archived ? <ArchiveRestore /> : <Archive />}
            </Button>
            <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => setConfirmDelete(true)}>
              <Trash2 />
            </Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Selling price" value={f.money(item.salePrice)} />
        <Stat label="Cost" value={f.money(item.purchasePrice)} />
        {item.trackStock && <Stat label="In stock" value={`${level.quantity} ${item.unit ?? ''}`} warn={item.reorderLevel !== undefined && level.quantity <= item.reorderLevel} />}
        {item.trackStock && <Stat label="Stock value" value={f.money(level.value)} />}
      </div>
      {item.trackStock && (
        <Card className="overflow-hidden">
          <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Stock movements</h2>
          {mine.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-fg-subtle">No stock in or out yet. Record a bill or an opening stock adjustment.</p>
          ) : (
            <ul className="divide-y divide-line">
              {mine.map((m) => (
                <li key={m.id} className="flex items-center gap-4 px-5 py-2.5 text-sm">
                  <span className="w-24 shrink-0 text-xs text-fg-subtle">{f.date(m.date)}</span>
                  <span className="min-w-0 flex-1 text-fg-muted">{m.sourceType === 'adjustment' ? 'Adjustment' : m.quantity > 0 ? 'Bought' : 'Sold'}</span>
                  <span className={cn('w-20 text-right font-medium tabular-nums', m.quantity > 0 ? 'text-success' : 'text-fg')}>
                    {m.quantity > 0 ? '+' : ''}
                    {m.quantity}
                  </span>
                  <span className="w-28 text-right text-fg-muted tabular-nums">{f.money(m.value)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <ItemDialog open={editing} onClose={() => setEditing(false)} item={item} />
      {adjusting && <AdjustStockDialog item={item} onClose={() => setAdjusting(false)} />}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false)
          try {
            await deleteItem(db, item.id)
            toast('Item deleted')
            navigate('/items', { replace: true })
          } catch (err) {
            toast(errorMessage(err), 'error')
          }
        }}
        danger
        title={`Delete ${item.name}?`}
        description="Items used on documents can't be deleted; archive them instead."
        confirmLabel="Delete"
      />
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className={cn('mt-0.5 truncate text-lg font-semibold', warn && 'text-warning')}>{value}</p>
    </div>
  )
}

export function AdjustStockDialog({ item, onClose }: { item?: Item; onClose: () => void }) {
  const company = useCompany()
  const { mode } = usePrefs()
  const toast = useToast()
  const accounts = useAccounts(company.id) ?? []
  const items = (useItems(company.id) ?? []).filter((i) => i.trackStock && !i.archived)
  const [itemId, setItemId] = useState(item?.id ?? '')
  const [direction, setDirection] = useState<'add' | 'remove'>('add')
  const [qty, setQty] = useState('')
  const [unitCost, setUnitCost] = useState(item?.purchasePrice ?? 0)
  const [date, setDate] = useState(today())
  const [reason, setReason] = useState('')
  const [accountId, setAccountId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const chosen = items.find((i) => i.id === itemId)
  const defaultAccount = direction === 'add' ? accounts.find((a) => a.systemKey === 'opening_balance')?.id : accounts.find((a) => a.systemKey === 'cogs')?.id

  const save = async () => {
    setError(null)
    try {
      const q = roundQty(Number(qty))
      if (!q || q < 0) throw new Error('Enter how many units.')
      await adjustStock(db, company.id, { itemId, date, quantity: direction === 'add' ? q : -q, unitCost: direction === 'add' ? unitCost : undefined, accountId: accountId || defaultAccount || '', reason })
      toast('Stock adjusted')
      onClose()
    } catch (err) {
      setError(errorMessage(err).replace(/^Something went wrong: /, ''))
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Adjust stock"
      description="Use this for opening stock, stock counts, damage or loss."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!itemId}>
            Save adjustment
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!item && (
          <Field label="Item">
            {(id) => (
              <Select id={id} value={itemId} onChange={(e) => (setItemId(e.target.value), setUnitCost(items.find((i) => i.id === e.target.value)?.purchasePrice ?? 0))}>
                <option value="">Choose an item</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Segmented
          label="Direction"
          value={direction}
          onChange={setDirection}
          className="w-full [&>button]:flex-1"
          options={[
            { value: 'add', label: 'Add stock' },
            { value: 'remove', label: 'Remove stock' },
          ]}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={`Quantity${chosen?.unit ? ` (${chosen.unit})` : ''}`}>{(id) => <Input id={id} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />}</Field>
          {direction === 'add' ? <Field label="Cost per unit">{(id) => <AmountInput id={id} value={unitCost} onChange={setUnitCost} />}</Field> : <span className="max-sm:hidden" />}
          <Field label="Date">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={direction === 'add' ? 'e.g. Opening stock' : 'e.g. Damaged, stock count'} maxLength={100} />}</Field>
        <Field label="Post the value to" hint={direction === 'add' ? 'Opening Balance Equity for opening stock.' : 'Cost of Sales, or a shrinkage/loss expense account.'}>
          {(id, d) => (
            <AccountPicker
              id={id}
              aria-describedby={d}
              accounts={accounts.filter((a) => a.subtype !== 'inventory')}
              value={accountId || defaultAccount || ''}
              onChange={setAccountId}
              showCodes={mode === 'accountant'}
              groupOrder={['expense', 'equity', 'income', 'liability', 'asset']}
            />
          )}
        </Field>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  )
}

export function StockPage() {
  const company = useCompany()
  const f = useFormat()
  const items = useItems(company.id)
  const moves = useStockMoves(company.id)
  const [adjusting, setAdjusting] = useState(false)
  const levels = useMemo(() => stockLevels(moves ?? []), [moves])
  if (!items || !moves) return <Spinner />
  const tracked = items.filter((i) => i.trackStock && !i.archived).sort((a, b) => a.name.localeCompare(b.name))
  const total = tracked.reduce((s, i) => s + (levels.get(i.id)?.value ?? 0), 0)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
          <p className="text-xs text-fg-subtle">Total stock value</p>
          <p className="mt-0.5 text-lg font-semibold">{f.money(total)}</p>
        </div>
        <Button icon={<SlidersHorizontal />} onClick={() => setAdjusting(true)} className="ml-auto" disabled={!tracked.length}>
          Adjust stock
        </Button>
      </div>
      <Card className="overflow-hidden">
        {tracked.length === 0 ? (
          <EmptyState icon={<Boxes />} title="No stock tracked yet" description="Turn on Track stock for a product to see quantities and value here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-fg-subtle">
                  <th className="px-5 py-2.5 font-medium">Item</th>
                  <th className="px-3 py-2.5 text-right font-medium">On hand</th>
                  <th className="px-3 py-2.5 text-right font-medium">Average cost</th>
                  <th className="px-5 py-2.5 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {tracked.map((i) => {
                  const l = levels.get(i.id) ?? { quantity: 0, value: 0, averageCost: 0 }
                  const low = i.reorderLevel !== undefined && l.quantity <= i.reorderLevel
                  return (
                    <tr key={i.id} className="border-b border-line last:border-0 hover:bg-surface-2/50">
                      <td className="px-5 py-2.5">
                        <Link to={`/items/${i.id}`} className="font-medium text-fg hover:text-primary-ink">
                          {i.name}
                        </Link>
                        {low && <Badge tone="warning" className="ml-2">Reorder</Badge>}
                      </td>
                      <td className={cn('px-3 py-2.5 text-right', l.quantity < 0 && 'text-danger')}>
                        {l.quantity} {i.unit ?? ''}
                      </td>
                      <td className="px-3 py-2.5 text-right">{f.money(Math.round(l.averageCost))}</td>
                      <td className="px-5 py-2.5 text-right font-medium">{f.money(l.value)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {adjusting && <AdjustStockDialog onClose={() => setAdjusting(false)} />}
    </div>
  )
}
