import type { LedgerDB } from '../db/database'
import type { Allocation, Payment } from '../db/types'
import { isISODate } from '../lib/dates'
import { newId } from '../lib/id'
import { settledAmounts } from './documents'
import { postGeneratedEntry, requireCompany, reverseEntry, takeNumber } from './engine'
import { AccountingError } from './errors'

export interface PaymentInput {
  direction: 'in' | 'out'
  contactId: string
  date: string
  amount: number
  accountId: string
  reference?: string
  notes?: string
  allocations: Allocation[]
}

const MONEY = new Set(['cash', 'bank', 'credit_card'])

/** Records money received from a customer or paid to a supplier, and settles invoices or bills with it. */
export async function savePayment(db: LedgerDB, companyId: string, input: PaymentInput, id?: string): Promise<Payment> {
  if (!input.contactId) throw new AccountingError(input.direction === 'in' ? 'Choose a customer.' : 'Choose a supplier.')
  if (!isISODate(input.date)) throw new AccountingError('Enter a valid date.')
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new AccountingError('Enter an amount greater than zero.')
  const allocations = input.allocations.filter((a) => a.amount > 0)
  const allocated = allocations.reduce((s, a) => s + a.amount, 0)
  if (allocated > input.amount) throw new AccountingError('The amounts applied add up to more than the payment.')

  return db.write(async () => {
    await requireCompany(db, companyId)
    const existing = id ? await db.payments.get(id) : undefined
    if (id && (!existing || existing.companyId !== companyId)) throw new AccountingError('Payment not found.', 'not_found')
    if (existing?.status === 'void') throw new AccountingError("A void payment can't be changed.")

    const account = await db.accounts.get(input.accountId)
    if (!account || account.companyId !== companyId || !MONEY.has(account.subtype)) throw new AccountingError('Choose a cash, bank or card account.')
    const contact = await db.contacts.get(input.contactId)
    if (!contact || contact.companyId !== companyId) throw new AccountingError('Contact not found.', 'not_found')

    const docs = await db.documents.where('companyId').equals(companyId).toArray()
    const payments = (await db.payments.where('companyId').equals(companyId).toArray()).filter((p) => p.id !== id)
    const settled = settledAmounts(docs, payments)
    const targetType = input.direction === 'in' ? 'invoice' : 'bill'
    for (const a of allocations) {
      const doc = docs.find((d) => d.id === a.documentId)
      if (!doc || doc.type !== targetType || doc.status !== 'posted' || doc.contactId !== input.contactId) {
        throw new AccountingError(`Payments can only settle posted ${targetType}s from the same ${input.direction === 'in' ? 'customer' : 'supplier'}.`)
      }
      if (a.amount > doc.total - (settled.get(doc.id) ?? 0)) throw new AccountingError(`That's more than is left to pay on ${doc.number}.`)
    }

    if (existing?.entryId) {
      const entry = await db.journalEntries.get(existing.entryId)
      if (entry?.status === 'posted') await reverseEntry(db, entry.id, entry.date, { silent: true, memo: `Payment ${existing.number} changed` })
    }

    const control = await db.accounts.where('[companyId+systemKey]').equals([companyId, input.direction === 'in' ? 'accounts_receivable' : 'accounts_payable']).first()
    if (!control) throw new AccountingError('The receivable or payable account is missing.')

    const at = Date.now()
    const number = existing?.number ?? (await takeNumber(db, companyId, input.direction === 'in' ? 'payment_in' : 'payment_out', input.direction === 'in' ? 'RCPT' : 'PAY'))
    const paymentId = existing?.id ?? newId()
    const entry = await postGeneratedEntry(db, companyId, {
      date: input.date,
      memo: `${input.direction === 'in' ? 'Payment from' : 'Payment to'} ${contact.name}`,
      reference: input.reference || number,
      source: 'payment',
      docId: paymentId,
      lines:
        input.direction === 'in'
          ? [
              { accountId: account.id, debit: input.amount },
              { accountId: control.id, credit: input.amount, contactId: contact.id },
            ]
          : [
              { accountId: control.id, debit: input.amount, contactId: contact.id },
              { accountId: account.id, credit: input.amount },
            ],
    })

    const payment: Payment = {
      id: paymentId,
      companyId,
      direction: input.direction,
      number,
      contactId: contact.id,
      date: input.date,
      amount: input.amount,
      accountId: account.id,
      reference: input.reference?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      allocations,
      status: 'posted',
      entryId: entry.id,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    }
    await db.payments.put(payment)
    await db.track(companyId, 'payments', payment.id)
    await db.logAudit(companyId, existing ? 'update' : 'create', 'payment', payment.id, `${existing ? 'Updated' : 'Recorded'} payment ${number} · ${contact.name}`)
    return payment
  })
}

export async function voidPayment(db: LedgerDB, id: string): Promise<void> {
  await db.write(async () => {
    const payment = await db.payments.get(id)
    if (!payment) throw new AccountingError('Payment not found.', 'not_found')
    if (payment.status === 'void') return
    if (payment.entryId) {
      const entry = await db.journalEntries.get(payment.entryId)
      if (entry?.status === 'posted') await reverseEntry(db, entry.id, entry.date, { silent: true, memo: `Payment ${payment.number} voided` })
    }
    await db.payments.update(id, { status: 'void', updatedAt: Date.now() })
    await db.track(payment.companyId, 'payments', id, { fields: ['status', 'updatedAt'] })
    await db.logAudit(payment.companyId, 'void', 'payment', id, `Voided payment ${payment.number}`)
  })
}

/** Spreads an amount over open documents, oldest first. */
export function autoAllocate(amount: number, open: { id: string; due: number }[]): Allocation[] {
  let left = amount
  const out: Allocation[] = []
  for (const d of open) {
    if (left <= 0) break
    const take = Math.min(left, d.due)
    if (take > 0) out.push({ documentId: d.id, amount: take })
    left -= take
  }
  return out
}
