import { useEffect, useState, type FormEvent } from 'react'
import { getCountry } from '../accounting/countries'
import { saveContact } from '../accounting/contacts'
import { errorMessage } from '../accounting/errors'
import { db } from '../db'
import type { Contact, ContactType } from '../db/types'
import { useCompany } from '../state/company'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Field, Input, Select, Textarea } from './ui/form'
import { Segmented } from './ui/misc'
import { useToast } from './ui/toast'

export const TERMS_OPTIONS = [
  { value: 0, label: 'Due on receipt' },
  { value: 7, label: 'Net 7 days' },
  { value: 14, label: 'Net 14 days' },
  { value: 15, label: 'Net 15 days' },
  { value: 30, label: 'Net 30 days' },
  { value: 45, label: 'Net 45 days' },
  { value: 60, label: 'Net 60 days' },
]

interface Props {
  open: boolean
  onClose: () => void
  type: ContactType
  contact?: Contact
  initialName?: string
  onSaved?: (c: Contact) => void
}

export function ContactDialog({ open, onClose, type, contact, initialName, onSaved }: Props) {
  const company = useCompany()
  const toast = useToast()
  const country = getCountry(company.country)
  const blank = { type, name: '', contactPerson: '', email: '', phone: '', taxId: '', address: '', shippingAddress: '', notes: '', paymentTermsDays: '' as number | '' }
  const [form, setForm] = useState(blank)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setMore(!!contact?.address || !!contact?.notes)
    setForm(
      contact
        ? {
            type: contact.type,
            name: contact.name,
            contactPerson: contact.contactPerson ?? '',
            email: contact.email ?? '',
            phone: contact.phone ?? '',
            taxId: contact.taxId ?? '',
            address: contact.address ?? '',
            shippingAddress: contact.shippingAddress ?? '',
            notes: contact.notes ?? '',
            paymentTermsDays: contact.paymentTermsDays ?? '',
          }
        : { ...blank, name: initialName ?? '' },
    )
    // Reset only when opening, or when switching contact.
  }, [open, contact?.id])

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))
  const noun = form.type === 'supplier' ? 'supplier' : form.type === 'customer' ? 'customer' : 'contact'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const saved = await saveContact(db, company.id, { ...form, paymentTermsDays: form.paymentTermsDays === '' ? undefined : form.paymentTermsDays }, contact?.id)
      toast(contact ? 'Contact updated' : `Added ${saved.name}`)
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={contact ? `Edit ${contact.name}` : `New ${noun}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="contact-form" disabled={busy}>
            {contact ? 'Save changes' : `Add ${noun}`}
          </Button>
        </>
      }
    >
      <form id="contact-form" onSubmit={submit} className="flex flex-col gap-4">
        <Segmented
          label="Contact type"
          value={form.type}
          onChange={(v) => set('type', v)}
          className="w-full [&>button]:flex-1"
          options={[
            { value: 'customer', label: 'Customer' },
            { value: 'supplier', label: 'Supplier' },
            { value: 'both', label: 'Both' },
          ]}
        />
        <Field label="Name">{(id) => <Input id={id} value={form.name} onChange={(e) => set('name', e.target.value)} data-autofocus placeholder="Business or person" maxLength={150} required />}</Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Email">{(id) => <Input id={id} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} maxLength={120} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} maxLength={40} />}</Field>
          <Field label="Payment terms">
            {(id) => (
              <Select id={id} value={form.paymentTermsDays} onChange={(e) => set('paymentTermsDays', e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">Use business default</option>
                {TERMS_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={country.taxIdLabel}>{(id) => <Input id={id} value={form.taxId} onChange={(e) => set('taxId', e.target.value)} maxLength={40} />}</Field>
        </div>
        {more ? (
          <>
            <Field label="Contact person">{(id) => <Input id={id} value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} maxLength={100} />}</Field>
            <Field label="Billing address">{(id) => <Textarea id={id} value={form.address} onChange={(e) => set('address', e.target.value)} rows={2} maxLength={300} />}</Field>
            <Field label="Shipping address" hint="Leave empty if it's the same.">
              {(id, d) => <Textarea id={id} aria-describedby={d} value={form.shippingAddress} onChange={(e) => set('shippingAddress', e.target.value)} rows={2} maxLength={300} />}
            </Field>
            <Field label="Notes">{(id) => <Textarea id={id} value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} maxLength={500} />}</Field>
          </>
        ) : (
          <button type="button" onClick={() => setMore(true)} className="self-start text-sm font-medium text-primary-ink hover:underline">
            + Address, contact person and notes
          </button>
        )}
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </form>
    </Dialog>
  )
}
