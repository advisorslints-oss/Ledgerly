import type { LedgerDB } from '../db/database'
import type { Contact, ContactType } from '../db/types'
import { newId } from '../lib/id'
import { AccountingError } from './errors'

export interface ContactInput {
  type: ContactType
  name: string
  contactPerson?: string
  email?: string
  phone?: string
  taxId?: string
  address?: string
  shippingAddress?: string
  paymentTermsDays?: number
  notes?: string
}

export const isCustomer = (c: Pick<Contact, 'type'>) => c.type === 'customer' || c.type === 'both'
export const isSupplier = (c: Pick<Contact, 'type'>) => c.type === 'supplier' || c.type === 'both'

function clean(input: ContactInput): ContactInput {
  const name = input.name.trim()
  if (!name) throw new AccountingError('Enter a name.')
  if (name.length > 150) throw new AccountingError('Keep the name under 150 characters.')
  const email = input.email?.trim() || undefined
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccountingError('Enter a valid email address, or leave it empty.')
  const terms = input.paymentTermsDays
  if (terms !== undefined && (!Number.isInteger(terms) || terms < 0 || terms > 365)) throw new AccountingError('Payment terms must be 0 to 365 days.')
  const trim = (s?: string) => s?.trim() || undefined
  return {
    type: input.type,
    name,
    email,
    paymentTermsDays: terms,
    contactPerson: trim(input.contactPerson),
    phone: trim(input.phone),
    taxId: trim(input.taxId),
    address: trim(input.address),
    shippingAddress: trim(input.shippingAddress),
    notes: trim(input.notes),
  }
}

export async function saveContact(db: LedgerDB, companyId: string, input: ContactInput, id?: string): Promise<Contact> {
  const data = clean(input)
  return db.write(async () => {
    const current = id ? await db.contacts.get(id) : undefined
    if (id && (!current || current.companyId !== companyId)) throw new AccountingError('Contact not found.', 'not_found')
    const lower = data.name.toLowerCase()
    const clash = await db.contacts
      .where('companyId')
      .equals(companyId)
      .filter((c) => c.id !== id && !c.archived && c.name.toLowerCase() === lower)
      .first()
    if (clash) throw new AccountingError(`You already have a contact called "${clash.name}".`, 'conflict')

    // A customer who is also a supplier (or the reverse) becomes "both" rather than losing history.
    let type = data.type
    if (current && current.type !== type && current.type !== 'both' && (await contactInUse(db, current.id, current.type))) type = 'both'

    const at = Date.now()
    const contact: Contact = { ...current, ...data, type, id: current?.id ?? newId(), companyId, archived: current?.archived ?? false, createdAt: current?.createdAt ?? at, updatedAt: at }
    await db.contacts.put(contact)
    await db.track(companyId, 'contacts', contact.id)
    await db.logAudit(companyId, current ? 'update' : 'create', 'contact', contact.id, `${current ? 'Updated' : 'Added'} ${contact.name}`)
    return contact
  })
}

async function contactInUse(db: LedgerDB, contactId: string, as?: ContactType): Promise<boolean> {
  const docs = await db.documents.where('contactId').equals(contactId).toArray()
  const sales = new Set(['invoice', 'quote', 'credit_note'])
  if (as === 'customer') return docs.some((d) => sales.has(d.type)) || (await db.payments.where('contactId').equals(contactId).filter((p) => p.direction === 'in').count()) > 0
  if (as === 'supplier') return docs.some((d) => !sales.has(d.type)) || (await db.payments.where('contactId').equals(contactId).filter((p) => p.direction === 'out').count()) > 0
  return docs.length > 0 || (await db.payments.where('contactId').equals(contactId).count()) > 0
}

export async function setContactArchived(db: LedgerDB, id: string, archived: boolean): Promise<void> {
  await db.write(async () => {
    const c = await db.contacts.get(id)
    if (!c) throw new AccountingError('Contact not found.', 'not_found')
    await db.contacts.update(id, { archived, updatedAt: Date.now() })
    await db.track(c.companyId, 'contacts', id, { fields: ['archived', 'updatedAt'] })
    await db.logAudit(c.companyId, archived ? 'archive' : 'restore', 'contact', id, `${archived ? 'Archived' : 'Restored'} ${c.name}`)
  })
}

export async function deleteContact(db: LedgerDB, id: string): Promise<void> {
  await db.write(async () => {
    const c = await db.contacts.get(id)
    if (!c) return
    if (await contactInUse(db, id)) throw new AccountingError(`${c.name} has transactions. Archive them instead.`, 'conflict')
    await db.contacts.delete(id)
    await db.track(c.companyId, 'contacts', id, { op: 'delete' })
    await db.logAudit(c.companyId, 'delete', 'contact', id, `Deleted ${c.name}`)
  })
}
