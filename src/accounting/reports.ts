import type { LedgerDB } from '../db/database'
import type { Account, JournalEntry, JournalLine } from '../db/types'
import { isDebitNormal } from './engine'

export const MIN_DATE = '0000-01-01'
export const MAX_DATE = '9999-12-31'

export interface Totals {
  debit: number
  credit: number
}

type LineLike = Pick<JournalLine, 'accountId' | 'debit' | 'credit'>

const ZERO: Totals = { debit: 0, credit: 0 }

export function totalsByAccount(lines: LineLike[]): Map<string, Totals> {
  const map = new Map<string, Totals>()
  for (const l of lines) {
    const t = map.get(l.accountId)
    if (t) {
      t.debit += l.debit
      t.credit += l.credit
    } else {
      map.set(l.accountId, { debit: l.debit, credit: l.credit })
    }
  }
  return map
}

/** Balance in the account's normal direction: positive cash is money you have, positive sales is income earned. */
export function naturalBalance(type: Account['type'], t: Totals): number {
  return isDebitNormal(type) ? t.debit - t.credit : t.credit - t.debit
}

export interface ReportRow {
  id: string
  label: string
  code?: string
  account?: Account
  amount: number
}

export interface ReportSection {
  id: string
  title: string
  rows: ReportRow[]
  total: number
}

function buildSection(
  id: string,
  title: string,
  accounts: Account[],
  totals: Map<string, Totals>,
  include: (a: Account) => boolean,
): ReportSection {
  const rows = accounts
    .filter(include)
    .map((account) => ({
      id: account.id,
      label: account.name,
      code: account.code,
      account,
      amount: naturalBalance(account.type, totals.get(account.id) ?? ZERO),
    }))
    .filter((r) => r.amount !== 0)
    .sort((x, y) => x.code.localeCompare(y.code))
  return { id, title, rows, total: rows.reduce((s, r) => s + r.amount, 0) }
}

export function netIncome(accounts: Account[], totals: Map<string, Totals>): number {
  let net = 0
  for (const account of accounts) {
    const t = totals.get(account.id)
    if (!t) continue
    if (account.type === 'income') net += t.credit - t.debit
    else if (account.type === 'expense') net -= t.debit - t.credit
  }
  return net
}

export interface ProfitLoss {
  income: ReportSection
  costOfSales: ReportSection
  grossProfit: number
  expenses: ReportSection
  operatingProfit: number
  otherIncome: ReportSection
  otherExpenses: ReportSection
  netProfit: number
}

export function computeProfitLoss(accounts: Account[], lines: LineLike[]): ProfitLoss {
  const totals = totalsByAccount(lines)
  const income = buildSection('income', 'Income', accounts, totals, (a) => a.type === 'income' && a.subtype !== 'other_income')
  const costOfSales = buildSection('cost_of_sales', 'Cost of sales', accounts, totals, (a) => a.type === 'expense' && a.subtype === 'cost_of_sales')
  const expenses = buildSection(
    'expenses',
    'Operating expenses',
    accounts,
    totals,
    (a) => a.type === 'expense' && a.subtype !== 'cost_of_sales' && a.subtype !== 'other_expense',
  )
  const otherIncome = buildSection('other_income', 'Other income', accounts, totals, (a) => a.subtype === 'other_income')
  const otherExpenses = buildSection('other_expenses', 'Other expenses', accounts, totals, (a) => a.subtype === 'other_expense')
  const grossProfit = income.total - costOfSales.total
  const operatingProfit = grossProfit - expenses.total
  return {
    income,
    costOfSales,
    grossProfit,
    expenses,
    operatingProfit,
    otherIncome,
    otherExpenses,
    netProfit: operatingProfit + otherIncome.total - otherExpenses.total,
  }
}

export interface BalanceSheet {
  currentAssets: ReportSection
  fixedAssets: ReportSection
  otherAssets: ReportSection
  totalAssets: number
  currentLiabilities: ReportSection
  longTermLiabilities: ReportSection
  totalLiabilities: number
  equity: ReportSection
  /** Assets minus liabilities minus equity. Always zero for books kept by this engine. */
  difference: number
}

const CURRENT_ASSETS = new Set(['cash', 'bank', 'receivable', 'inventory', 'tax_receivable', 'current_asset'])
const CURRENT_LIABILITIES = new Set(['payable', 'credit_card', 'tax_payable', 'current_liability'])

/**
 * `lines` must be every line up to and including the report date. Profit isn't closed into
 * retained earnings by an entry, so it is calculated here: earlier years roll into retained
 * earnings and the current year shows on its own line.
 */
export function computeBalanceSheet(accounts: Account[], lines: Pick<JournalLine, 'accountId' | 'debit' | 'credit' | 'date'>[], fiscalYearStart: string): BalanceSheet {
  const totals = totalsByAccount(lines)
  const priorTotals = totalsByAccount(lines.filter((l) => l.date < fiscalYearStart))
  const priorEarnings = netIncome(accounts, priorTotals)
  const currentEarnings = netIncome(accounts, totals) - priorEarnings

  const currentAssets = buildSection('current_assets', 'Current assets', accounts, totals, (a) => CURRENT_ASSETS.has(a.subtype))
  const fixedAssets = buildSection('fixed_assets', 'Fixed assets', accounts, totals, (a) => a.subtype === 'fixed_asset')
  const otherAssets = buildSection('other_assets', 'Other assets', accounts, totals, (a) => a.subtype === 'other_asset')
  const currentLiabilities = buildSection('current_liabilities', 'Current liabilities', accounts, totals, (a) => CURRENT_LIABILITIES.has(a.subtype))
  const longTermLiabilities = buildSection('long_term_liabilities', 'Long-term liabilities', accounts, totals, (a) => a.subtype === 'long_term_liability')
  const equity = buildSection('equity', 'Equity', accounts, totals, (a) => a.type === 'equity')

  if (priorEarnings) equity.rows.push({ id: 'prior_earnings', label: 'Profit from earlier years', amount: priorEarnings })
  if (currentEarnings) equity.rows.push({ id: 'current_earnings', label: 'Profit for this year', amount: currentEarnings })
  equity.total += priorEarnings + currentEarnings

  const totalAssets = currentAssets.total + fixedAssets.total + otherAssets.total
  const totalLiabilities = currentLiabilities.total + longTermLiabilities.total
  return {
    currentAssets,
    fixedAssets,
    otherAssets,
    totalAssets,
    currentLiabilities,
    longTermLiabilities,
    totalLiabilities,
    equity,
    difference: totalAssets - totalLiabilities - equity.total,
  }
}

export interface TrialBalanceRow {
  account: Account
  debit: number
  credit: number
}

export interface TrialBalance {
  rows: TrialBalanceRow[]
  totalDebit: number
  totalCredit: number
}

export function computeTrialBalance(accounts: Account[], lines: LineLike[]): TrialBalance {
  const totals = totalsByAccount(lines)
  const rows: TrialBalanceRow[] = []
  for (const account of accounts) {
    const t = totals.get(account.id)
    if (!t) continue
    const net = t.debit - t.credit
    if (net === 0) continue
    rows.push({ account, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 })
  }
  rows.sort((x, y) => x.account.code.localeCompare(y.account.code))
  return {
    rows,
    totalDebit: rows.reduce((s, r) => s + r.debit, 0),
    totalCredit: rows.reduce((s, r) => s + r.credit, 0),
  }
}

export interface LedgerRow {
  line: JournalLine
  entry?: JournalEntry
  balance: number
}

export function computeLedger(
  account: Account,
  opening: number,
  lines: JournalLine[],
  entries: Map<string, JournalEntry>,
): LedgerRow[] {
  const sorted = [...lines].sort(
    (x, y) =>
      x.date.localeCompare(y.date) ||
      (entries.get(x.entryId)?.createdAt ?? 0) - (entries.get(y.entryId)?.createdAt ?? 0) ||
      x.order - y.order,
  )
  let balance = opening
  return sorted.map((line) => {
    balance += isDebitNormal(account.type) ? line.debit - line.credit : line.credit - line.debit
    return { line, entry: entries.get(line.entryId), balance }
  })
}

export interface MonthPoint {
  month: string
  income: number
  expenses: number
  profit: number
}

/** Income and expenses per calendar month for each month start in `months`. */
export function monthlyResults(accounts: Account[], lines: Pick<JournalLine, 'accountId' | 'debit' | 'credit' | 'date'>[], months: string[]): MonthPoint[] {
  const typeById = new Map(accounts.map((a) => [a.id, a.type]))
  const points = new Map(months.map((m) => [m.slice(0, 7), { month: m, income: 0, expenses: 0, profit: 0 }]))
  for (const l of lines) {
    const point = points.get(l.date.slice(0, 7))
    if (!point) continue
    const type = typeById.get(l.accountId)
    if (type === 'income') point.income += l.credit - l.debit
    else if (type === 'expense') point.expenses += l.debit - l.credit
  }
  return [...points.values()].map((p) => ({ ...p, profit: p.income - p.expenses }))
}

export function loadLines(db: LedgerDB, companyId: string, from = MIN_DATE, to = MAX_DATE): Promise<JournalLine[]> {
  return db.journalLines.where('[companyId+date]').between([companyId, from], [companyId, to], true, true).toArray()
}

export function loadAccounts(db: LedgerDB, companyId: string): Promise<Account[]> {
  return db.accounts.where('companyId').equals(companyId).toArray()
}
