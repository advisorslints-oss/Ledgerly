import type { LedgerDB } from '../db/database'
import type { Account, Allocation, Company, Doc, DocLine, DocStatus, DocType, Item, Payment, StockMove, TaxRate } from '../db/types'
import { addDays, isISODate, today } from '../lib/dates'
import { newId } from '../lib/id'
import { postGeneratedEntry, requireCompany, reverseEntry, takeNumber, type LineInput } from './engine'
import { AccountingError } from './errors'
import { currentUnitCost, roundQty } from './items'

export interface DocTypeInfo {
  type: DocType
  label: string
  plural: string
  prefix: string
  side: 'sales' | 'purchases'
  contactLabel: 'Customer' | 'Supplier'
  contactRequired: boolean
  /** Posted documents create journal entries; quotes and purchase orders never do. */
  posts: boolean
  /** Credit notes and supplier credits reduce what's owed on invoices or bills. */
  credit: boolean
  dueLabel?: string
  convertsTo?: DocType
  path: string
}

export const DOC_TYPES: Record<DocType, DocTypeInfo> = {
  invoice: { type: 'invoice', label: 'Invoice', plural: 'Invoices', prefix: 'INV', side: 'sales', contactLabel: 'Customer', contactRequired: true, posts: true, credit: false, dueLabel: 'Due date', path: '/sales/invoices' },
  quote: { type: 'quote', label: 'Quote', plural: 'Quotes', prefix: 'QT', side: 'sales', contactLabel: 'Customer', contactRequired: true, posts: false, credit: false, dueLabel: 'Valid until', convertsTo: 'invoice', path: '/sales/quotes' },
  credit_note: { type: 'credit_note', label: 'Credit note', plural: 'Credit notes', prefix: 'CN', side: 'sales', contactLabel: 'Customer', contactRequired: true, posts: true, credit: true, path: '/sales/credit-notes' },
  bill: { type: 'bill', label: 'Bill', plural: 'Bills', prefix: 'BILL', side: 'purchases', contactLabel: 'Supplier', contactRequired: true, posts: true, credit: false, dueLabel: 'Due date', path: '/purchases/bills' },
  purchase_order: { type: 'purchase_order', label: 'Purchase order', plural: 'Purchase orders', prefix: 'PO', side: 'purchases', contactLabel: 'Supplier', contactRequired: true, posts: false, credit: false, dueLabel: 'Expected by', convertsTo: 'bill', path: '/purchases/orders' },
  supplier_credit: { type: 'supplier_credit', label: 'Supplier credit', plural: 'Supplier credits', prefix: 'SC', side: 'purchases', contactLabel: 'Supplier', contactRequired: true, posts: true, credit: true, path: '/purchases/credits' },
  expense: { type: 'expense', label: 'Expense', plural: 'Expenses', prefix: 'EXP', side: 'purchases', contactLabel: 'Supplier', contactRequired: false, posts: true, credit: false, path: '/purchases/expenses' },
}

/** Which documents a credit or payment can settle. */
export const SETTLES: Partial<Record<DocType, DocType>> = { credit_note: 'invoice', supplier_credit: 'bill' }

export function lineGross(line: Pick<DocLine, 'quantity' | 'rate' | 'discountPct'>): number {
  return Math.round(line.quantity * line.rate * (1 - (line.discountPct ?? 0) / 100))
}

export interface TaxPart {
  key: string
  name: string
  rate: number
  amount: number
  /** The account this part posts to on this side, if the tax is claimable or collected. */
  accountId?: string
}

export interface LineTotal {
  lineId: string
  gross: number
  net: number
  tax: number
  parts: TaxPart[]
}

export interface DocTotals {
  lines: LineTotal[]
  subtotal: number
  taxTotal: number
  total: number
  taxes: TaxPart[]
}

/** Works out net, tax and total per line and for the document, rounding each tax part to whole minor units. */
export function computeTotals(
  lines: Pick<DocLine, 'id' | 'quantity' | 'rate' | 'discountPct' | 'taxRateId'>[],
  taxRates: ReadonlyMap<string, TaxRate>,
  taxInclusive: boolean,
  side: 'sales' | 'purchases',
): DocTotals {
  const taxes = new Map<string, TaxPart>()
  const out: LineTotal[] = lines.map((line) => {
    const gross = lineGross(line)
    const components = (line.taxRateId ? taxRates.get(line.taxRateId)?.components : undefined)?.filter((c) => c.rate > 0) ?? []
    const totalRate = components.reduce((s, c) => s + c.rate, 0)
    const parts: TaxPart[] = components.map((c) => {
      const amount = taxInclusive ? Math.round((gross * c.rate) / (100 + totalRate)) : Math.round((gross * c.rate) / 100)
      const accountId = side === 'sales' ? c.salesAccountId : c.purchaseAccountId
      return { key: `${c.name}|${c.rate}|${accountId ?? ''}`, name: c.name, rate: c.rate, amount, accountId }
    })
    const tax = parts.reduce((s, p) => s + p.amount, 0)
    for (const p of parts) {
      const t = taxes.get(p.key)
      if (t) t.amount += p.amount
      else taxes.set(p.key, { ...p })
    }
    return { lineId: line.id, gross, net: taxInclusive ? gross - tax : gross, tax, parts }
  })
  const subtotal = out.reduce((s, l) => s + l.net, 0)
  const taxTotal = out.reduce((s, l) => s + l.tax, 0)
  return { lines: out, subtotal, taxTotal, total: subtotal + taxTotal, taxes: [...taxes.values()].filter((t) => t.amount !== 0) }
}

export interface DocInput {
  type: DocType
  number?: string
  contactId?: string
  date: string
  dueDate?: string
  reference?: string
  lines: DocLine[]
  taxInclusive: boolean
  notes?: string
  terms?: string
  paidFromAccountId?: string
}

interface Ctx {
  company: Company
  accounts: Map<string, Account>
  taxRates: Map<string, TaxRate>
  items: Map<string, Item>
}

async function loadCtx(db: LedgerDB, companyId: string): Promise<Ctx> {
  const [company, accounts, taxRates, items] = await Promise.all([
    requireCompany(db, companyId),
    db.accounts.where('companyId').equals(companyId).toArray(),
    db.taxRates.where('companyId').equals(companyId).toArray(),
    db.items.where('companyId').equals(companyId).toArray(),
  ])
  return { company, accounts: new Map(accounts.map((a) => [a.id, a])), taxRates: new Map(taxRates.map((t) => [t.id, t])), items: new Map(items.map((i) => [i.id, i])) }
}

const systemAccount = (ctx: Ctx, key: Account['systemKey']) => [...ctx.accounts.values()].find((a) => a.systemKey === key)

function cleanLines(input: DocInput, ctx: Ctx, info: DocTypeInfo): DocLine[] {
  const lines = input.lines
    .map((l) => ({ ...l, description: l.description.trim(), quantity: roundQty(l.quantity) }))
    .filter((l) => l.itemId || l.description || l.rate)
  if (!lines.length) throw new AccountingError('Add at least one line.')
  lines.forEach((l, i) => {
    const n = `Line ${i + 1}`
    if (!l.description && !l.itemId) throw new AccountingError(`${n}: add a description.`)
    if (!Number.isFinite(l.quantity) || l.quantity <= 0) throw new AccountingError(`${n}: quantity must be more than zero.`)
    if (!Number.isSafeInteger(l.rate) || l.rate < 0) throw new AccountingError(`${n}: price must be zero or more.`)
    if (l.discountPct !== undefined && (l.discountPct < 0 || l.discountPct > 100)) throw new AccountingError(`${n}: discount must be between 0 and 100%.`)
    const item = l.itemId ? ctx.items.get(l.itemId) : undefined
    if (l.itemId && !item) throw new AccountingError(`${n}: the item no longer exists.`)
    // Stock bought goes to the inventory account so its cost moves to the P&L only when it's sold.
    if (item?.trackStock && info.side === 'purchases') l.accountId = item.inventoryAccountId!
    const account = ctx.accounts.get(l.accountId)
    if (info.posts && !account) throw new AccountingError(`${n}: choose an account.`)
    if (l.taxRateId && !ctx.taxRates.has(l.taxRateId)) throw new AccountingError(`${n}: the tax rate no longer exists.`)
  })
  return lines.map((l) => ({ ...l, id: l.id || newId() }))
}

function validateHeader(input: DocInput, info: DocTypeInfo, ctx: Ctx): void {
  if (!isISODate(input.date)) throw new AccountingError('Enter a valid date.')
  if (input.dueDate && (!isISODate(input.dueDate) || input.dueDate < input.date)) throw new AccountingError(`${info.dueLabel ?? 'Due date'} can't be before the ${info.label.toLowerCase()} date.`)
  if (info.contactRequired && !input.contactId) throw new AccountingError(`Choose a ${info.contactLabel.toLowerCase()}.`)
  if (input.type === 'expense') {
    const from = input.paidFromAccountId ? ctx.accounts.get(input.paidFromAccountId) : undefined
    if (!from) throw new AccountingError('Choose the account you paid from.')
  }
}

/** Builds the journal lines and stock movements a posted document creates. */
async function buildPosting(db: LedgerDB, doc: Doc, totals: DocTotals, ctx: Ctx, info: DocTypeInfo): Promise<{ lines: LineInput[]; moves: StockMove[] }> {
  const sign = info.credit ? -1 : 1
  const lines: LineInput[] = []
  const moves: StockMove[] = []
  const add = (accountId: string, amount: number, contactId?: string) => {
    if (amount > 0) lines.push({ accountId, debit: amount, contactId })
    else if (amount < 0) lines.push({ accountId, credit: -amount, contactId })
  }
  const move = (itemId: string, quantity: number, value: number) =>
    moves.push({
      id: newId(),
      companyId: doc.companyId,
      itemId,
      date: doc.date,
      quantity: roundQty(quantity),
      unitCost: Math.round(Math.abs(value / quantity)),
      value,
      sourceType: 'document',
      sourceId: doc.id,
      createdAt: Date.now(),
    })

  if (info.side === 'sales') {
    const ar = systemAccount(ctx, 'accounts_receivable')
    if (!ar) throw new AccountingError('The Accounts Receivable account is missing.')
    add(ar.id, sign * totals.total, doc.contactId)
    for (const lt of totals.lines) add(doc.lines.find((l) => l.id === lt.lineId)!.accountId, -sign * lt.net)
    for (const t of totals.taxes) {
      if (!t.accountId) throw new AccountingError(`The ${t.name} tax has no account to collect into. Fix it in Settings → Taxes.`)
      add(t.accountId, -sign * t.amount)
    }
    // Selling stock moves its cost from inventory to cost of sales, at today's average cost.
    for (const l of doc.lines) {
      const item = l.itemId ? ctx.items.get(l.itemId) : undefined
      if (!item?.trackStock || !item.inventoryAccountId) continue
      const cogs = systemAccount(ctx, 'cogs')
      if (!cogs) throw new AccountingError('The Cost of Sales account is missing.')
      const unitCost = await currentUnitCost(db, item, doc.id)
      const value = Math.round(unitCost * l.quantity)
      add(cogs.id, sign * value)
      add(item.inventoryAccountId, -sign * value)
      move(item.id, -sign * l.quantity, -sign * value)
    }
  } else {
    const creditAccount = doc.type === 'expense' ? doc.paidFromAccountId! : systemAccount(ctx, 'accounts_payable')?.id
    if (!creditAccount) throw new AccountingError('The Accounts Payable account is missing.')
    add(creditAccount, -sign * totals.total, doc.type === 'expense' ? undefined : doc.contactId)
    for (const lt of totals.lines) {
      const line = doc.lines.find((l) => l.id === lt.lineId)!
      // Tax you can't claim back is part of the cost.
      const unclaimed = lt.parts.filter((p) => !p.accountId).reduce((s, p) => s + p.amount, 0)
      add(line.accountId, sign * (lt.net + unclaimed))
      for (const p of lt.parts) if (p.accountId) add(p.accountId, sign * p.amount)
      const item = line.itemId ? ctx.items.get(line.itemId) : undefined
      if (item?.trackStock) move(item.id, sign * line.quantity, sign * (lt.net + unclaimed))
    }
  }
  return { lines, moves }
}

async function unpost(db: LedgerDB, doc: Doc): Promise<void> {
  if (doc.entryId) {
    const entry = await db.journalEntries.get(doc.entryId)
    if (entry?.status === 'posted') await reverseEntry(db, entry.id, entry.date, { silent: true, memo: `${DOC_TYPES[doc.type].label} ${doc.number} changed` })
  }
  const moves = await db.stockMoves.where('sourceId').equals(doc.id).toArray()
  if (moves.length) {
    await db.stockMoves.bulkDelete(moves.map((m) => m.id))
    await db.track(doc.companyId, 'stockMoves', moves.map((m) => m.id), { op: 'delete' })
  }
}

/** Total paid or credited against each invoice or bill, from posted payments and credits. */
export function settledAmounts(docs: Pick<Doc, 'status' | 'allocations' | 'type'>[], payments: Pick<Payment, 'status' | 'allocations'>[]): Map<string, number> {
  const map = new Map<string, number>()
  const add = (allocs?: Allocation[]) => allocs?.forEach((a) => map.set(a.documentId, (map.get(a.documentId) ?? 0) + a.amount))
  for (const p of payments) if (p.status === 'posted') add(p.allocations)
  for (const d of docs) if (d.status === 'posted' && DOC_TYPES[d.type].credit) add(d.allocations)
  return map
}

async function settledFor(db: LedgerDB, companyId: string, docId: string, except?: string): Promise<number> {
  const [docs, payments] = await Promise.all([
    db.documents.where('companyId').equals(companyId).toArray(),
    db.payments.where('companyId').equals(companyId).toArray(),
  ])
  return (
    settledAmounts(
      docs.filter((d) => d.id !== except),
      payments.filter((p) => p.id !== except),
    ).get(docId) ?? 0
  )
}

export interface SaveOptions {
  id?: string
  /** For invoices, bills and similar: post to the books (otherwise saved as a draft). */
  post?: boolean
  /** For quotes and purchase orders: the status to save with. */
  status?: DocStatus
  /** Id to give a new document, so files attached before the first save stay linked. */
  assignId?: string
}

export async function saveDocument(db: LedgerDB, companyId: string, input: DocInput, opts: SaveOptions = {}): Promise<Doc> {
  return db.write(async () => {
    const info = DOC_TYPES[input.type]
    const ctx = await loadCtx(db, companyId)
    const existing = opts.id ? await db.documents.get(opts.id) : undefined
    if (opts.id && (!existing || existing.companyId !== companyId)) throw new AccountingError('Document not found.', 'not_found')
    if (existing && existing.type !== input.type) throw new AccountingError("A document's type can't change.")
    if (existing?.status === 'void') throw new AccountingError(`This ${info.label.toLowerCase()} is void and can't be changed.`)
    if (existing?.status === 'converted') throw new AccountingError(`This ${info.label.toLowerCase()} was already converted.`)

    validateHeader(input, info, ctx)
    const lines = cleanLines(input, ctx, info)
    const totals = computeTotals(lines, ctx.taxRates, input.taxInclusive, info.side)

    let number = input.number?.trim() || existing?.number
    if (number && number !== existing?.number) {
      const clash = await db.documents
        .where('[companyId+type]')
        .equals([companyId, input.type])
        .filter((d) => d.id !== existing?.id && d.number.toLowerCase() === number!.toLowerCase())
        .first()
      if (clash) throw new AccountingError(`${info.label} ${number} already exists.`, 'conflict')
    }
    number ??= await takeNumber(db, companyId, input.type, info.prefix)

    const status: DocStatus = info.posts
      ? opts.post || existing?.status === 'posted'
        ? 'posted'
        : 'draft'
      : (opts.status ?? existing?.status ?? 'draft')

    if (existing?.status === 'posted') {
      const settled = info.credit ? (existing.allocations ?? []).reduce((s, a) => s + a.amount, 0) : await settledFor(db, companyId, existing.id)
      if (settled > totals.total) throw new AccountingError(`${number} already has ${info.credit ? 'credits applied' : 'payments'} larger than the new total.`)
      await unpost(db, existing)
    }

    const at = Date.now()
    const doc: Doc = {
      id: existing?.id ?? opts.assignId ?? newId(),
      companyId,
      type: input.type,
      number,
      contactId: input.contactId || undefined,
      date: input.date,
      dueDate: input.dueDate || undefined,
      reference: input.reference?.trim() || undefined,
      status,
      lines,
      taxInclusive: input.taxInclusive,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      notes: input.notes?.trim() || undefined,
      terms: input.terms?.trim() || undefined,
      paidFromAccountId: input.type === 'expense' ? input.paidFromAccountId : undefined,
      convertedFromId: existing?.convertedFromId,
      convertedToId: existing?.convertedToId,
      allocations: existing?.allocations,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    }

    if (status === 'posted') {
      if (doc.total <= 0) throw new AccountingError('The total must be more than zero to post.')
      const contact = doc.contactId ? await db.contacts.get(doc.contactId) : undefined
      const posting = await buildPosting(db, doc, totals, ctx, info)
      const entry = await postGeneratedEntry(db, companyId, {
        date: doc.date,
        memo: `${info.label} ${doc.number}${contact ? ` · ${contact.name}` : ''}`,
        reference: doc.reference,
        source: 'document',
        docId: doc.id,
        lines: posting.lines,
      })
      doc.entryId = entry.id
      if (posting.moves.length) {
        await db.stockMoves.bulkAdd(posting.moves)
        await db.track(companyId, 'stockMoves', posting.moves.map((m) => m.id))
      }
    }

    await db.documents.put(doc)
    await db.track(companyId, 'documents', doc.id)
    const verb = !existing ? 'Created' : existing.status !== 'posted' && status === 'posted' ? 'Posted' : 'Updated'
    await db.logAudit(companyId, verb.toLowerCase(), 'document', doc.id, `${verb} ${info.label.toLowerCase()} ${doc.number} (${status})`)
    return doc
  })
}

export async function voidDocument(db: LedgerDB, id: string): Promise<void> {
  await db.write(async () => {
    const doc = await db.documents.get(id)
    if (!doc) throw new AccountingError('Document not found.', 'not_found')
    const info = DOC_TYPES[doc.type]
    if (doc.status !== 'posted') throw new AccountingError(`Only posted ${info.plural.toLowerCase()} can be voided.`)
    if (info.credit && (doc.allocations ?? []).some((a) => a.amount > 0)) throw new AccountingError('Remove the credit from the invoices or bills it was applied to first.')
    if (!info.credit && (await settledFor(db, doc.companyId, doc.id)) > 0) throw new AccountingError(`${doc.number} has payments or credits. Void or change those first.`)
    await unpost(db, doc)
    await db.documents.update(id, { status: 'void', entryId: undefined, updatedAt: Date.now() })
    await db.track(doc.companyId, 'documents', id, { fields: ['status', 'entryId', 'updatedAt'] })
    await db.logAudit(doc.companyId, 'void', 'document', id, `Voided ${info.label.toLowerCase()} ${doc.number}`)
  })
}

export async function deleteDocument(db: LedgerDB, id: string): Promise<void> {
  await db.write(async () => {
    const doc = await db.documents.get(id)
    if (!doc) return
    const info = DOC_TYPES[doc.type]
    if (info.posts && doc.status !== 'draft') throw new AccountingError(`Posted ${info.plural.toLowerCase()} can't be deleted. Void it instead.`)
    await db.documents.delete(id)
    await db.track(doc.companyId, 'documents', id, { op: 'delete' })
    const files = await db.attachments.where('parentId').equals(id).primaryKeys()
    if (files.length) {
      await db.attachments.bulkDelete(files)
      await db.track(doc.companyId, 'attachments', files, { op: 'delete' })
    }
    await db.logAudit(doc.companyId, 'delete', 'document', id, `Deleted ${info.label.toLowerCase()} ${doc.number}`)
  })
}

export async function setDocumentStatus(db: LedgerDB, id: string, status: DocStatus): Promise<void> {
  await db.write(async () => {
    const doc = await db.documents.get(id)
    if (!doc) throw new AccountingError('Document not found.', 'not_found')
    if (DOC_TYPES[doc.type].posts) throw new AccountingError('Use post or void for this document.')
    await db.documents.update(id, { status, updatedAt: Date.now() })
    await db.track(doc.companyId, 'documents', id, { fields: ['status', 'updatedAt'] })
    await db.logAudit(doc.companyId, 'status', 'document', id, `Marked ${DOC_TYPES[doc.type].label.toLowerCase()} ${doc.number} as ${status}`)
  })
}

/** Turns a quote into a draft invoice, or a purchase order into a draft bill. */
export async function convertDocument(db: LedgerDB, id: string): Promise<Doc> {
  return db.write(async () => {
    const source = await db.documents.get(id)
    if (!source) throw new AccountingError('Document not found.', 'not_found')
    const target = DOC_TYPES[source.type].convertsTo
    if (!target) throw new AccountingError("This document can't be converted.")
    if (source.status === 'converted') throw new AccountingError('This was already converted.')
    const company = await requireCompany(db, source.companyId)
    const contact = source.contactId ? await db.contacts.get(source.contactId) : undefined
    const date = today()
    const terms = contact?.paymentTermsDays ?? company.documentSettings?.paymentTermsDays ?? 0
    const doc = await saveDocument(db, source.companyId, {
      type: target,
      contactId: source.contactId,
      date,
      dueDate: addDays(date, terms),
      reference: source.number,
      lines: source.lines.map((l) => ({ ...l, id: newId() })),
      taxInclusive: source.taxInclusive,
      notes: source.notes,
      terms: source.terms,
    })
    await db.documents.update(doc.id, { convertedFromId: source.id })
    await db.documents.update(source.id, { status: 'converted', convertedToId: doc.id, updatedAt: Date.now() })
    await db.track(source.companyId, 'documents', [doc.id, source.id])
    return { ...doc, convertedFromId: source.id }
  })
}

/** Copies a document into a new draft dated today. */
export async function duplicateDocument(db: LedgerDB, id: string): Promise<Doc> {
  const source = await db.documents.get(id)
  if (!source) throw new AccountingError('Document not found.', 'not_found')
  const date = today()
  const gap = source.dueDate ? Math.round((Date.parse(source.dueDate) - Date.parse(source.date)) / 86_400_000) : undefined
  return saveDocument(db, source.companyId, {
    type: source.type,
    contactId: source.contactId,
    date,
    dueDate: gap !== undefined ? addDays(date, gap) : undefined,
    lines: source.lines.map((l) => ({ ...l, id: newId() })),
    taxInclusive: source.taxInclusive,
    notes: source.notes,
    terms: source.terms,
    paidFromAccountId: source.paidFromAccountId,
  })
}

/** Applies a posted credit note (or supplier credit) to open invoices (or bills) of the same contact. */
export async function applyCredit(db: LedgerDB, creditId: string, allocations: Allocation[]): Promise<void> {
  await db.write(async () => {
    const credit = await db.documents.get(creditId)
    if (!credit || credit.status !== 'posted' || !DOC_TYPES[credit.type].credit) throw new AccountingError('Only posted credits can be applied.')
    const targetType = SETTLES[credit.type]!
    const clean = allocations.filter((a) => a.amount > 0)
    const total = clean.reduce((s, a) => s + a.amount, 0)
    if (total > credit.total) throw new AccountingError("You can't apply more than the credit's total.")
    for (const a of clean) {
      const target = await db.documents.get(a.documentId)
      if (!target || target.type !== targetType || target.status !== 'posted' || target.contactId !== credit.contactId) {
        throw new AccountingError('A credit can only be applied to posted documents of the same contact.')
      }
      const due = target.total - (await settledFor(db, credit.companyId, target.id, credit.id))
      if (a.amount > due) throw new AccountingError(`That's more than is left to pay on ${target.number}.`)
    }
    await db.documents.update(creditId, { allocations: clean, updatedAt: Date.now() })
    await db.track(credit.companyId, 'documents', creditId, { fields: ['allocations', 'updatedAt'] })
    await db.logAudit(credit.companyId, 'apply', 'document', creditId, `Applied ${DOC_TYPES[credit.type].label.toLowerCase()} ${credit.number}`)
  })
}

export type DocState = 'draft' | 'unpaid' | 'partial' | 'paid' | 'overdue' | 'void' | 'open' | 'applied' | DocStatus

/** The status a person cares about: paid, overdue, and so on. */
export function docState(doc: Doc, settled: number, asOf = today()): DocState {
  const info = DOC_TYPES[doc.type]
  if (!info.posts) {
    if ((doc.status === 'sent' || doc.status === 'issued') && doc.dueDate && doc.dueDate < asOf && doc.type === 'quote') return 'expired' as DocState
    return doc.status
  }
  if (doc.status !== 'posted') return doc.status
  // An expense is money already spent from a cash, bank or card account.
  if (doc.type === 'expense') return 'paid'
  if (info.credit) {
    const used = (doc.allocations ?? []).reduce((s, a) => s + a.amount, 0)
    return used >= doc.total ? 'applied' : 'open'
  }
  if (settled >= doc.total) return 'paid'
  if (doc.dueDate && doc.dueDate < asOf) return 'overdue'
  return settled > 0 ? 'partial' : 'unpaid'
}

export const STATE_LABELS: Record<string, { label: string; tone: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  unpaid: { label: 'Unpaid', tone: 'primary' },
  partial: { label: 'Part paid', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  overdue: { label: 'Overdue', tone: 'danger' },
  void: { label: 'Void', tone: 'neutral' },
  open: { label: 'Available', tone: 'primary' },
  applied: { label: 'Used', tone: 'success' },
  sent: { label: 'Sent', tone: 'primary' },
  accepted: { label: 'Accepted', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
  converted: { label: 'Converted', tone: 'success' },
  issued: { label: 'Issued', tone: 'primary' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'warning' },
  posted: { label: 'Posted', tone: 'primary' },
}
