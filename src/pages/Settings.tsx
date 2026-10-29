import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, ArchiveRestore, Download, HardDrive, Lock, MonitorSmartphone, Pencil, Plus, Share, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { exportCompany, parseBackup, restoreBackup, type BackupFile } from '../accounting/backup'
import { deleteCompany, saveTaxRate, setLockDate, setTaxRateArchived, updateCompany } from '../accounting/company'
import { getCountry } from '../accounting/countries'
import { errorMessage } from '../accounting/errors'
import { AccountPicker } from '../components/AccountPicker'
import { Button } from '../components/ui/button'
import { ConfirmDialog, Dialog } from '../components/ui/dialog'
import { Field, Input, Select, Switch, Textarea } from '../components/ui/form'
import { Badge, Card, CardHeader, Segmented, Spinner } from '../components/ui/misc'
import { useToast } from '../components/ui/toast'
import { db } from '../db'
import type { TaxComponent, TaxRate } from '../db/types'
import { cn } from '../lib/cn'
import { MONTHS, addDays, fiscalYearStart, today } from '../lib/dates'
import { CURRENCIES } from '../lib/money'
import { downloadFile, requestPersistentStorage, toCSV, useInstall } from '../lib/platform'
import { useCompany, useFormat } from '../state/company'
import { useAccounts } from '../state/data'
import { setPrefs, usePrefs } from '../state/prefs'

const TABS = [
  { id: 'business', label: 'Business' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'taxes', label: 'Taxes' },
  { id: 'lock', label: 'Lock books' },
  { id: 'data', label: 'Backup & data' },
  { id: 'activity', label: 'Activity log' },
] as const
type TabId = (typeof TABS)[number]['id']

export function Settings() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'business') as TabId
  return (
    <div>
      <h1 className="mb-5 text-2xl font-semibold tracking-tight sm:text-[26px]">Settings</h1>
      <div className="-mx-4 mb-6 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <nav className="flex gap-1" aria-label="Settings sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setParams({ tab: t.id }, { replace: true })}
              aria-current={tab === t.id ? 'page' : undefined}
              className={cn(
                '-mb-px border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                tab === t.id ? 'border-primary text-fg' : 'border-transparent text-fg-subtle hover:text-fg',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="max-w-3xl">
        {tab === 'business' && <BusinessTab />}
        {tab === 'preferences' && <PreferencesTab />}
        {tab === 'taxes' && <TaxesTab />}
        {tab === 'lock' && <LockTab />}
        {tab === 'data' && <DataTab />}
        {tab === 'activity' && <ActivityTab />}
      </div>
    </div>
  )
}

function Section({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card className="mb-5">
      <CardHeader title={title} description={description} />
      <div className="px-5 pb-5">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
    </Card>
  )
}

function BusinessTab() {
  const company = useCompany()
  const toast = useToast()
  const country = getCountry(company.country)
  const hasEntries = useLiveQuery(() => db.journalEntries.where('companyId').equals(company.id).count(), [company.id])
  const [form, setForm] = useState(() => ({
    name: company.name,
    legalName: company.legalName ?? '',
    taxId: company.taxId ?? '',
    email: company.email ?? '',
    phone: company.phone ?? '',
    address: company.address ?? '',
    currency: company.currency,
    fiscalYearStartMonth: company.fiscalYearStartMonth,
    features: company.features,
  }))
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))

  const save = async () => {
    setBusy(true)
    try {
      await updateCompany(db, company.id, form)
      toast('Business details saved')
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Section
        title="Business details"
        description="Shown on reports, and on invoices once sales arrive."
        footer={
          <Button variant="primary" onClick={save} disabled={busy}>
            Save changes
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Business name">{(id) => <Input id={id} value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={100} />}</Field>
          <Field label="Legal name" hint="If different, e.g. registered company name.">
            {(id, d) => <Input id={id} aria-describedby={d} value={form.legalName} onChange={(e) => set('legalName', e.target.value)} maxLength={150} />}
          </Field>
          <Field label={country.taxIdLabel}>{(id) => <Input id={id} value={form.taxId} onChange={(e) => set('taxId', e.target.value)} maxLength={40} />}</Field>
          <Field label="Email">{(id) => <Input id={id} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} maxLength={120} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} maxLength={40} />}</Field>
          <Field label="Country" hint="Set when the business was created.">
            {(id, d) => <Input id={id} aria-describedby={d} value={country.name} disabled />}
          </Field>
          <Field label="Address" className="sm:col-span-2">
            {(id) => <Textarea id={id} value={form.address} onChange={(e) => set('address', e.target.value)} rows={2} maxLength={300} />}
          </Field>
        </div>
      </Section>

      <Section title="Accounting" description="Your currency and financial year.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Currency" hint={hasEntries ? 'Locked because transactions exist.' : undefined}>
            {(id, d) => (
              <Select id={id} aria-describedby={d} value={form.currency} disabled={!!hasEntries} onChange={(e) => set('currency', e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Financial year starts in">
            {(id) => (
              <Select id={id} value={form.fiscalYearStartMonth} onChange={(e) => set('fiscalYearStartMonth', Number(e.target.value))}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Section>

      <Section title="Features" description="Turn on what your business needs.">
        <div className="flex flex-col gap-4">
          <Switch
            checked={form.features.inventory}
            onChange={(v) => set('features', { ...form.features, inventory: v })}
            label="Inventory"
            description="Track the value of stock you hold. Adds an inventory account if you don't have one."
          />
          <Switch
            checked={form.features.projects}
            onChange={(v) => set('features', { ...form.features, projects: v })}
            label="Projects & jobs"
            description="Track profit per project or job (arriving in a coming update)."
          />
        </div>
      </Section>
    </>
  )
}

function PreferencesTab() {
  const prefs = usePrefs()
  const install = useInstall()
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<string | null>(null)

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(false))
    navigator.storage
      ?.estimate?.()
      .then((e) => e.usage !== undefined && setUsage(`${(e.usage / 1024 / 1024).toFixed(1)} MB`))
      .catch(() => {})
  }, [])

  return (
    <>
      <Section title="Appearance">
        <Segmented
          label="Theme"
          value={prefs.theme}
          onChange={(theme) => setPrefs({ theme })}
          options={[
            { value: 'system', label: 'Match device' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Section>
      <Section title="Accounting terms" description="Choose how much accounting detail you want to see.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              ['simple', 'Simple', 'Plain words like money in and money out. Account codes and the trial balance stay out of the way.'],
              ['accountant', 'Accountant', 'Account codes, journal, debits and credits everywhere.'],
            ] as const
          ).map(([value, title, text]) => (
            <button
              key={value}
              type="button"
              onClick={() => setPrefs({ mode: value })}
              aria-pressed={prefs.mode === value}
              className={cn(
                'rounded-xl border p-4 text-left transition-all',
                prefs.mode === value ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'border-line hover:border-line-strong',
              )}
            >
              <span className="block text-sm font-semibold">{title}</span>
              <span className="mt-1 block text-xs text-fg-subtle">{text}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Install as an app" description="Get Ledgerly on your desktop, taskbar or home screen. It opens in its own window and works offline.">
        <div className="flex items-start gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-ink">
            <MonitorSmartphone className="size-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm text-fg-muted">
            {install.installed ? (
              <p>
                <strong className="font-medium text-fg">Installed.</strong> You're using the app version.
              </p>
            ) : install.canInstall ? (
              <Button variant="primary" onClick={() => void install.install()}>
                Install Ledgerly
              </Button>
            ) : install.ios ? (
              <p>
                In Safari, tap <Share className="inline size-4" /> <strong className="font-medium text-fg">Share</strong>, then <strong className="font-medium text-fg">Add to Home Screen</strong>.
              </p>
            ) : (
              <ul className="list-disc space-y-1 pl-4">
                <li>
                  <strong className="font-medium text-fg">Chrome or Edge on a computer:</strong> click the install icon at the right of the address bar.
                </li>
                <li>
                  <strong className="font-medium text-fg">Android:</strong> open the browser menu and choose <em>Install app</em> or <em>Add to Home screen</em>.
                </li>
                <li>
                  <strong className="font-medium text-fg">iPhone or iPad:</strong> in Safari, tap Share, then <em>Add to Home Screen</em>.
                </li>
              </ul>
            )}
          </div>
        </div>
      </Section>
      <Section title="Storage on this device">
        <div className="flex items-start gap-4 text-sm text-fg-muted">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-muted">
            <HardDrive className="size-5" />
          </span>
          <div className="flex-1">
            <p>
              {persisted ? (
                <>
                  <strong className="font-medium text-fg">Protected.</strong> The browser won't clear your data to free up space.
                </>
              ) : (
                <>
                  <strong className="font-medium text-fg">Not protected yet.</strong> The browser may clear data when storage runs low. Install the app or allow protection, and keep backups.
                </>
              )}
            </p>
            {usage && <p className="mt-1 text-xs text-fg-subtle">Using {usage}</p>}
            {!persisted && (
              <Button className="mt-3" size="sm" onClick={async () => setPersisted(await requestPersistentStorage())}>
                Protect my data
              </Button>
            )}
          </div>
        </div>
      </Section>
    </>
  )
}

function TaxesTab() {
  const company = useCompany()
  const rates = useLiveQuery(() => db.taxRates.where('companyId').equals(company.id).toArray(), [company.id])
  const accounts = useAccounts(company.id)
  const toast = useToast()
  const [editing, setEditing] = useState<TaxRate | 'new' | null>(null)

  if (!rates || !accounts) return <Spinner />
  const byId = new Map(accounts.map((a) => [a.id, a.name]))
  const sorted = [...rates].sort((a, b) => Number(a.archived) - Number(b.archived) || a.rate - b.rate || a.name.localeCompare(b.name))

  return (
    <>
      <Section
        title={`${company.taxName} rates`}
        description="These will be applied to invoices and bills. Check the rates against your local rules."
        footer={
          <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>
            Add tax rate
          </Button>
        }
      >
        {sorted.length === 0 ? (
          <p className="text-sm text-fg-subtle">No tax rates yet. Add the rates you charge.</p>
        ) : (
          <ul className="-mx-5 divide-y divide-line border-y border-line">
            {sorted.map((t) => (
              <li key={t.id} className="flex items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className={cn('flex items-center gap-2 text-sm font-medium', t.archived && 'text-fg-subtle')}>
                    {t.name}
                    {t.archived && <Badge>Archived</Badge>}
                  </p>
                  <p className="truncate text-xs text-fg-subtle">
                    {t.components.length ? t.components.map((c) => `${c.name} ${c.rate}% → ${byId.get(c.salesAccountId ?? '') ?? '—'}`).join(' · ') : 'No tax charged'}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums">{t.rate}%</span>
                <Button size="icon" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
                  <Pencil />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t.archived ? `Restore ${t.name}` : `Archive ${t.name}`}
                  onClick={async () => {
                    await setTaxRateArchived(db, t.id, !t.archived)
                    toast(t.archived ? 'Tax rate restored' : 'Tax rate archived')
                  }}
                >
                  {t.archived ? <ArchiveRestore /> : <Archive />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {editing && <TaxRateDialog rate={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function TaxRateDialog({ rate, onClose }: { rate?: TaxRate; onClose: () => void }) {
  const company = useCompany()
  const { mode } = usePrefs()
  const toast = useToast()
  const accounts = useAccounts(company.id) ?? []
  const [name, setName] = useState(rate?.name ?? '')
  const [components, setComponents] = useState<TaxComponent[]>(rate?.components.length ? rate.components : [{ name: company.taxName, rate: 0 }])
  const [error, setError] = useState<string | null>(null)
  const liabilities = accounts.filter((a) => a.type === 'liability')
  const assets = accounts.filter((a) => a.type === 'asset')
  const total = components.reduce((s, c) => s + (Number.isFinite(c.rate) ? c.rate : 0), 0)
  const update = (i: number, patch: Partial<TaxComponent>) => setComponents((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const save = async () => {
    try {
      await saveTaxRate(db, company.id, { name, components }, rate?.id)
      toast('Tax rate saved')
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
      title={rate ? 'Edit tax rate' : 'New tax rate'}
      description="Split a rate into parts when it is paid to different authorities, like CGST and SGST."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save tax rate
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${company.taxName} ${total || 10}%`} data-autofocus />}</Field>
        {components.map((c, i) => (
          <div key={i} className="rounded-xl border border-line p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
              <Field label="Component">{(id) => <Input id={id} value={c.name} onChange={(e) => update(i, { name: e.target.value })} />}</Field>
              <Field label="Rate %">
                {(id) => <Input id={id} inputMode="decimal" value={Number.isFinite(c.rate) ? String(c.rate) : ''} onChange={(e) => update(i, { rate: Number(e.target.value) })} className="tabular-nums" />}
              </Field>
              {components.length > 1 && (
                <Button className="self-end" size="icon" variant="ghost" aria-label="Remove component" onClick={() => setComponents((list) => list.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              )}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Collected on sales into">
                {(id) => <AccountPicker id={id} accounts={liabilities} value={c.salesAccountId ?? ''} onChange={(v) => update(i, { salesAccountId: v })} showCodes={mode === 'accountant'} groupOrder={['liability']} />}
              </Field>
              <Field label="Claimed on purchases into" hint="Leave empty if it can't be claimed back.">
                {(id, d) => (
                  <AccountPicker
                    id={id}
                    aria-describedby={d}
                    accounts={assets}
                    value={c.purchaseAccountId ?? ''}
                    onChange={(v) => update(i, { purchaseAccountId: v })}
                    showCodes={mode === 'accountant'}
                    groupOrder={['asset']}
                    placeholder="Not claimable"
                  />
                )}
              </Field>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setComponents((list) => [...list, { name: '', rate: 0 }])}>
            Add component
          </Button>
          <span className="text-sm text-fg-muted">
            Total <strong className="text-fg tabular-nums">{Math.round(total * 1000) / 1000}%</strong>
          </span>
        </div>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  )
}

function LockTab() {
  const company = useCompany()
  const f = useFormat()
  const toast = useToast()
  const suggestion = addDays(fiscalYearStart(today(), company.fiscalYearStartMonth), -1)
  const [date, setDate] = useState(company.lockDate ?? suggestion)

  const apply = async (value: string | undefined) => {
    try {
      await setLockDate(db, company.id, value)
      toast(value ? `Books locked up to ${f.date(value)}` : 'Lock removed')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  return (
    <Section
      title="Lock the books"
      description="Once you've filed taxes or closed a year, lock it. Nobody can then add, change or reverse entries on or before the lock date."
      footer={
        <>
          {company.lockDate && <Button onClick={() => apply(undefined)}>Remove lock</Button>}
          <Button variant="primary" icon={<Lock />} onClick={() => apply(date)}>
            {company.lockDate ? 'Update lock date' : 'Lock books'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <Field label="Lock entries up to and including" className="sm:w-72">
          {(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <p className="text-sm text-fg-muted sm:pb-2.5">
          {company.lockDate ? (
            <>
              Currently locked up to <strong className="font-medium text-fg">{f.date(company.lockDate)}</strong>.
            </>
          ) : (
            'Not locked.'
          )}
        </p>
      </div>
    </Section>
  )
}

function DataTab() {
  const company = useCompany()
  const f = useFormat()
  const toast = useToast()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<BackupFile | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmName, setConfirmName] = useState('')

  const backup = async () => {
    try {
      const data = await exportCompany(db, company.id)
      downloadFile(`${company.name} backup ${today()}.ledgerly.json`, JSON.stringify(data), 'application/json')
      toast('Backup downloaded. Keep it somewhere safe, like cloud storage or a USB drive.')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const exportTransactions = async () => {
    const [entries, lines, accounts] = await Promise.all([
      db.journalEntries.where('companyId').equals(company.id).toArray(),
      db.journalLines.where('companyId').equals(company.id).toArray(),
      db.accounts.where('companyId').equals(company.id).toArray(),
    ])
    const byEntry = new Map(entries.map((e) => [e.id, e]))
    const byAccount = new Map(accounts.map((a) => [a.id, a]))
    const rows: (string | number)[][] = [['Date', 'Number', 'Description', 'Reference', 'Account code', 'Account', 'Debit', 'Credit', 'Line note', 'Status']]
    for (const l of [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.entryId.localeCompare(b.entryId) || a.order - b.order)) {
      const e = byEntry.get(l.entryId)
      const a = byAccount.get(l.accountId)
      rows.push([l.date, e?.number ?? '', e?.memo ?? '', e?.reference ?? '', a?.code ?? '', a?.name ?? '', f.toInput(l.debit), f.toInput(l.credit), l.description ?? '', e?.status ?? ''])
    }
    downloadFile(`${company.name} transactions.csv`, toCSV(rows), 'text/csv')
  }

  const pickFile = async (file: File) => {
    try {
      setPending(parseBackup(await file.text()))
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const restore = async () => {
    if (!pending) return
    try {
      await restoreBackup(db, pending)
      setPrefs({ companyId: pending.company.id })
      toast(`Restored ${pending.company.name}`)
      setPending(null)
      navigate('/')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const remove = async () => {
    await deleteCompany(db, company.id)
    setPrefs({ companyId: undefined })
    toast(`${company.name} was deleted from this device`)
    navigate('/', { replace: true })
  }

  const lastBackup = company.lastBackupAt ? new Date(company.lastBackupAt).toLocaleString(company.locale, { dateStyle: 'medium', timeStyle: 'short' }) : null

  return (
    <>
      <Section
        title="Backup"
        description="Your books are stored in this browser on this device. Download a backup regularly, and use it to move your books to another computer or phone."
        footer={
          <>
            <Button icon={<Upload />} onClick={() => fileRef.current?.click()}>
              Restore from file
            </Button>
            <Button variant="primary" icon={<Download />} onClick={backup}>
              Download backup
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">{lastBackup ? `Last backup: ${lastBackup}` : 'No backup yet.'}</p>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void pickFile(file)
          }}
        />
      </Section>
      <Section
        title="Export"
        description="Every journal line as a spreadsheet, for your accountant or another system."
        footer={
          <Button icon={<Download />} onClick={exportTransactions}>
            Export transactions (CSV)
          </Button>
        }
      >
        <p className="text-sm text-fg-muted">Each report also has its own CSV and print buttons.</p>
      </Section>
      <Section title="Danger zone" description="Permanently remove this business and all its records from this device.">
        <Button variant="danger" icon={<Trash2 />} onClick={() => setDeleting(true)}>
          Delete {company.name}
        </Button>
      </Section>

      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={restore}
        title={`Restore ${pending?.company.name}?`}
        description={`Backup from ${pending ? new Date(pending.exportedAt).toLocaleString() : ''} with ${pending?.journalEntries.length ?? 0} entries. If this business already exists on this device, its current data will be replaced.`}
        confirmLabel="Restore"
      />
      <ConfirmDialog
        open={deleting}
        onClose={() => {
          setDeleting(false)
          setConfirmName('')
        }}
        onConfirm={remove}
        danger
        title={`Delete ${company.name}?`}
        description="This erases every account and transaction for this business on this device. Download a backup first if you might need it."
        confirmLabel="Delete forever"
        confirmDisabled={confirmName.trim() !== company.name}
      >
        <Field label={`Type "${company.name}" to confirm`}>{(id) => <Input id={id} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />}</Field>
      </ConfirmDialog>
    </>
  )
}

function ActivityTab() {
  const company = useCompany()
  const events = useLiveQuery(
    () => db.audit.where('[companyId+at]').between([company.id, 0], [company.id, Infinity]).reverse().limit(300).toArray(),
    [company.id],
  )
  if (!events) return <Spinner />
  return (
    <Section title="Activity log" description="A permanent record of every change made to these books on this device.">
      <ul className="-mx-5 divide-y divide-line border-y border-line">
        {events.map((e) => (
          <li key={e.id} className="flex gap-4 px-5 py-2.5 text-sm">
            <span className="w-40 shrink-0 text-xs text-fg-subtle">{new Date(e.at).toLocaleString(company.locale, { dateStyle: 'medium', timeStyle: 'short' })}</span>
            <span className="min-w-0 flex-1 text-fg">{e.summary}</span>
          </li>
        ))}
        {events.length === 0 && <li className="px-5 py-6 text-center text-sm text-fg-subtle">No activity yet.</li>}
      </ul>
    </Section>
  )
}
