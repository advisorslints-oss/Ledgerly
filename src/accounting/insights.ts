import type { Account, Contact, Doc, Item, JournalEntry, JournalLine, TaxRate } from '../db/types'
import { fromISODate } from '../lib/dates'
import { computeTotals, DOC_TYPES } from './documents'
import { isDebitNormal } from './engine'
import { computeLedger, naturalBalance, totalsByAccount, type LedgerRow } from './reports'

// ---------- Ageing ----------

export interface AgingRow {
  id: string
  name: string
  current: number
  d30: number
  d60: number
  d90: number
  older: number
  total: number
}

const BUCKETS = ['current', 'd30', 'd60', 'd90', 'older'] as const

/** What customers owe (invoices) or what you owe suppliers (bills), by how overdue it is. */
export function agingReport(docs: Doc[], settled: Map<string, number>, type: 'invoice' | 'bill', asOf: string, contacts: Map<string, Contact>): { rows: AgingRow[]; totals: AgingRow } {
  const rows = new Map<string, AgingRow>()
  const empty = (id: string, name: string): AgingRow => ({ id, name, current: 0, d30: 0, d60: 0, d90: 0, older: 0, total: 0 })
  const totals = empty('total', 'Total')
  const asOfTime = fromISODate(asOf).getTime()
  for (const d of docs) {
    if (d.type !== type || d.status !== 'posted' || d.date > asOf) continue
    const due = d.total - (settled.get(d.id) ?? 0)
    if (due <= 0) continue
    const days = Math.floor((asOfTime - fromISODate(d.dueDate ?? d.date).getTime()) / 86_400_000)
    const bucket = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'older'
    const id = d.contactId ?? 'none'
    const row = rows.get(id) ?? empty(id, contacts.get(id)?.name ?? 'No contact')
    row[bucket] += due
    row.total += due
    totals[bucket] += due
    totals.total += due
    rows.set(id, row)
  }
  return { rows: [...rows.values()].sort((a, b) => b.total - a.total), totals }
}
export { BUCKETS as AGING_BUCKETS }

// ---------- Sales and purchases ----------

export interface ByContactRow {
  id: string
  name: string
  count: number
  net: number
  tax: number
  total: number
}

const salesSign = (d: Doc) => (d.type === 'invoice' ? 1 : d.type === 'credit_note' ? -1 : 0)
const purchaseSign = (d: Doc) => (d.type === 'bill' || d.type === 'expense' ? 1 : d.type === 'supplier_credit' ? -1 : 0)

export function byContact(docs: Doc[], from: string, to: string, side: 'sales' | 'purchases', contacts: Map<string, Contact>): ByContactRow[] {
  const sign = side === 'sales' ? salesSign : purchaseSign
  const rows = new Map<string, ByContactRow>()
  for (const d of docs) {
    const s = sign(d)
    if (!s || d.status !== 'posted' || d.date < from || d.date > to) continue
    const id = d.contactId ?? 'none'
    const row = rows.get(id) ?? { id, name: contacts.get(id)?.name ?? (side === 'sales' ? 'No customer' : 'No supplier'), count: 0, net: 0, tax: 0, total: 0 }
    row.count += s > 0 ? 1 : 0
    row.net += s * d.subtotal
    row.tax += s * d.taxTotal
    row.total += s * d.total
    rows.set(id, row)
  }
  return [...rows.values()].sort((a, b) => b.net - a.net)
}

export interface ByItemRow {
  id: string
  name: string
  quantity: number
  net: number
}

export function byItem(docs: Doc[], from: string, to: string, side: 'sales' | 'purchases', items: Map<string, Item>, taxRates: Map<string, TaxRate>): ByItemRow[] {
  const sign = side === 'sales' ? salesSign : purchaseSign
  const rows = new Map<string, ByItemRow>()
  for (const d of docs) {
    const s = sign(d)
    if (!s || d.status !== 'posted' || d.date < from || d.date > to) continue
    const totals = computeTotals(d.lines, taxRates, d.taxInclusive, DOC_TYPES[d.type].side)
    d.lines.forEach((l, i) => {
      const id = l.itemId ?? 'none'
      const row = rows.get(id) ?? { id, name: (l.itemId && items.get(l.itemId)?.name) || 'Other (no item)', quantity: 0, net: 0 }
      row.quantity += s * l.quantity
      row.net += s * totals.lines[i].net
      rows.set(id, row)
    })
  }
  return [...rows.values()].sort((a, b) => b.net - a.net)
}

// ---------- Tax ----------

export interface TaxRow {
  account: Account
  amount: number
}

/** Tax collected on sales and tax paid on purchases you can claim back, for filing a return. */
export function taxSummary(accounts: Account[], lines: Pick<JournalLine, 'accountId' | 'debit' | 'credit'>[]) {
  const totals = totalsByAccount(lines)
  const row = (a: Account): TaxRow => ({ account: a, amount: naturalBalance(a.type, totals.get(a.id) ?? { debit: 0, credit: 0 }) })
  const collected = accounts.filter((a) => a.subtype === 'tax_payable').map(row)
  const claimable = accounts.filter((a) => a.subtype === 'tax_receivable').map(row)
  const totalCollected = collected.reduce((s, r) => s + r.amount, 0)
  const totalClaimable = claimable.reduce((s, r) => s + r.amount, 0)
  return { collected, claimable, totalCollected, totalClaimable, net: totalCollected - totalClaimable }
}

// ---------- Cash flow ----------

export type CashCategory = 'operating' | 'investing' | 'financing'

export function cashCategory(a: Account): CashCategory {
  if (a.subtype === 'fixed_asset' || a.subtype === 'other_asset') return 'investing'
  if (a.subtype === 'long_term_liability' || a.type === 'equity') return 'financing'
  return 'operating'
}

export interface CashFlowSection {
  category: CashCategory
  rows: { account: Account; amount: number }[]
  total: number
}

/**
 * Direct-method cash flow: every movement in cash and bank accounts, attributed to the other
 * accounts in the same entry. Transfers between cash accounts cancel out.
 */
export function cashFlow(accounts: Account[], rangeLines: JournalLine[], openingLines: Pick<JournalLine, 'accountId' | 'debit' | 'credit'>[]) {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const isCash = (id: string) => {
    const a = byId.get(id)
    return a?.subtype === 'cash' || a?.subtype === 'bank'
  }
  const byEntry = new Map<string, JournalLine[]>()
  for (const l of rangeLines) byEntry.set(l.entryId, [...(byEntry.get(l.entryId) ?? []), l])

  const perAccount = new Map<string, number>()
  for (const lines of byEntry.values()) {
    const cashDelta = lines.filter((l) => isCash(l.accountId)).reduce((s, l) => s + l.debit - l.credit, 0)
    if (!cashDelta) continue
    const others = lines.filter((l) => !isCash(l.accountId))
    // Weight each counterpart by how much it moved against the cash.
    const weights = others.map((l) => ({ l, w: Math.sign(cashDelta) * (l.credit - l.debit) })).filter((x) => x.w > 0)
    const W = weights.reduce((s, x) => s + x.w, 0)
    if (!W) continue
    let assigned = 0
    weights.forEach((x, i) => {
      const share = i === weights.length - 1 ? cashDelta - assigned : Math.round((cashDelta * x.w) / W)
      assigned += share
      perAccount.set(x.l.accountId, (perAccount.get(x.l.accountId) ?? 0) + share)
    })
  }

  const sections: Record<CashCategory, CashFlowSection> = {
    operating: { category: 'operating', rows: [], total: 0 },
    investing: { category: 'investing', rows: [], total: 0 },
    financing: { category: 'financing', rows: [], total: 0 },
  }
  for (const [id, amount] of perAccount) {
    const account = byId.get(id)
    if (!account || !amount) continue
    const s = sections[cashCategory(account)]
    s.rows.push({ account, amount })
    s.total += amount
  }
  for (const s of Object.values(sections)) s.rows.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
  const opening = openingLines.filter((l) => isCash(l.accountId)).reduce((s, l) => s + l.debit - l.credit, 0)
  const net = sections.operating.total + sections.investing.total + sections.financing.total
  return { sections, opening, net, closing: opening + net }
}

// ---------- General ledger ----------

export interface LedgerSection {
  account: Account
  opening: number
  rows: LedgerRow[]
  closing: number
}

export function generalLedger(accounts: Account[], before: Pick<JournalLine, 'accountId' | 'debit' | 'credit'>[], within: JournalLine[], entries: Map<string, JournalEntry>): LedgerSection[] {
  const openingTotals = totalsByAccount(before)
  const byAccount = new Map<string, JournalLine[]>()
  for (const l of within) byAccount.set(l.accountId, [...(byAccount.get(l.accountId) ?? []), l])
  return [...accounts]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((account) => {
      const t = openingTotals.get(account.id)
      const opening = t ? (isDebitNormal(account.type) ? t.debit - t.credit : t.credit - t.debit) : 0
      const rows = computeLedger(account, opening, byAccount.get(account.id) ?? [], entries)
      return { account, opening, rows, closing: rows.length ? rows[rows.length - 1].balance : opening }
    })
    .filter((s) => s.rows.length || s.opening)
}
