import type { LedgerDB } from '../db/database'
import type { Account, BankLine, BankRule, JournalLine, Reconciliation } from '../db/types'
import { isISODate } from '../lib/dates'
import { newId } from '../lib/id'
import { parseAmount } from '../lib/money'
import { isDebitNormal, postGeneratedEntry } from './engine'
import { AccountingError } from './errors'

// ---------- Reading statement files ----------

/** Parses CSV (comma, semicolon or tab separated), including quoted cells with commas and line breaks. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell.trim())
      if (row.some((c) => c)) rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell.trim())
  if (row.some((c) => c)) rows.push(row)
  return rows
}

export interface ColumnMap {
  date: number
  description: number
  amount: number
  debit: number
  credit: number
  reference: number
}

/** Guesses which column is which from the header row. -1 means not present. */
export function guessColumns(header: string[]): ColumnMap {
  const find = (re: RegExp, skip: number[] = []) => header.findIndex((h, i) => !skip.includes(i) && re.test(h.trim()))
  const date = find(/date/i)
  const debit = find(/debit|withdrawal|paid out|money out|^dr\.?$|outflow/i)
  const credit = find(/credit|deposit|paid in|money in|^cr\.?$|inflow/i)
  const amount = find(/^amount|amount$|^value$|amount \(/i, [debit, credit])
  const description = find(/desc|narration|details|particulars|memo|payee|transaction|remarks|name/i, [date])
  const reference = find(/ref|cheque|chq|check no/i, [date, description])
  return { date, description, amount, debit, credit, reference }
}

export type DateFormat = 'ymd' | 'dmy' | 'mdy'

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Reads dates like 2026-10-05, 05/10/2026, 10/05/26 or 5 Oct 2026. */
export function parseStatementDate(value: string, format: DateFormat): string | null {
  const s = value.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, '')
  let y: number, m: number, d: number
  const named = s.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,})[\s\-/.,]+(\d{2,4})$/) ?? null
  const namedFirst = s.match(/^([A-Za-z]{3,})[\s\-/.]+(\d{1,2})[\s,\-/.]+(\d{2,4})$/) ?? null
  if (named || namedFirst) {
    const [dd, mon, yy] = named ? [named[1], named[2], named[3]] : [namedFirst![2], namedFirst![1], namedFirst![3]]
    m = MONTH_NAMES.indexOf(mon.slice(0, 3).toLowerCase()) + 1
    d = Number(dd)
    y = Number(yy)
  } else {
    const parts = s.split(/[\s\-/.]+/).map(Number)
    if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p))) return null
    if (String(s.split(/[\s\-/.]+/)[0]).length === 4) [y, m, d] = parts
    else if (format === 'mdy') [m, d, y] = parts
    else [d, m, y] = parts
  }
  if (y < 100) y += 2000
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return isISODate(iso) ? iso : null
}

/** Picks day-first or month-first by looking for values that only work one way. */
export function guessDateFormat(values: string[], fallback: DateFormat): DateFormat {
  for (const v of values) {
    const parts = v.trim().split(/[\s\-/.]+/)
    if (parts[0]?.length === 4) return 'ymd'
    const [a, b] = parts.map(Number)
    if (a > 12 && b <= 12) return 'dmy'
    if (b > 12 && a <= 12) return 'mdy'
  }
  return fallback
}

export interface StatementRow {
  date: string
  description: string
  amount: number
  reference?: string
}

export function mapRows(rows: string[][], map: ColumnMap, format: DateFormat, digits: number): { rows: StatementRow[]; skipped: number } {
  const out: StatementRow[] = []
  let skipped = 0
  for (const r of rows) {
    const date = map.date >= 0 ? parseStatementDate(r[map.date] ?? '', format) : null
    let amount: number | null = null
    if (map.amount >= 0) amount = parseAmount(r[map.amount] ?? '', digits)
    else {
      const credit = map.credit >= 0 && r[map.credit] ? parseAmount(r[map.credit], digits) : 0
      const debit = map.debit >= 0 && r[map.debit] ? parseAmount(r[map.debit], digits) : 0
      amount = credit === null || debit === null ? null : Math.abs(credit) - Math.abs(debit)
    }
    if (!date || amount === null || amount === 0) {
      skipped++
      continue
    }
    out.push({
      date,
      amount,
      description: (map.description >= 0 ? r[map.description] : '') || 'Bank transaction',
      reference: map.reference >= 0 ? r[map.reference] || undefined : undefined,
    })
  }
  return { rows: out, skipped }
}

const lineKey = (l: Pick<BankLine, 'date' | 'amount' | 'description'>) => `${l.date}|${l.amount}|${l.description.toLowerCase()}`

/** Adds statement lines to review, skipping ones already imported. */
export async function importStatement(db: LedgerDB, companyId: string, accountId: string, rows: StatementRow[]): Promise<{ added: number; duplicates: number }> {
  return db.write(async () => {
    const existing = await db.bankLines.where('[accountId+date]').between([accountId, ''], [accountId, '￿']).toArray()
    const counts = new Map<string, number>()
    for (const l of existing) counts.set(lineKey(l), (counts.get(lineKey(l)) ?? 0) + 1)
    const batch = newId()
    const at = Date.now()
    const fresh: BankLine[] = []
    let duplicates = 0
    for (const r of rows) {
      const k = lineKey(r)
      if (counts.get(k)) {
        counts.set(k, counts.get(k)! - 1)
        duplicates++
        continue
      }
      fresh.push({ id: newId(), companyId, accountId, date: r.date, description: r.description.slice(0, 300), amount: r.amount, reference: r.reference, status: 'new', importBatch: batch, createdAt: at, updatedAt: at })
    }
    if (fresh.length) {
      await db.bankLines.bulkAdd(fresh)
      await db.track(companyId, 'bankLines', fresh.map((l) => l.id))
      await db.logAudit(companyId, 'import', 'bankLines', batch, `Imported ${fresh.length} bank statement lines`)
    }
    return { added: fresh.length, duplicates }
  })
}

// ---------- Reviewing statement lines ----------

/** Money in or out of this account as a signed amount (positive = in). */
export const signedForAccount = (l: Pick<JournalLine, 'debit' | 'credit'>) => l.debit - l.credit

export function findMatches(line: BankLine, candidates: JournalLine[], used: Set<string>, days = 7): JournalLine[] {
  const t = Date.parse(line.date)
  return candidates
    .filter((c) => !used.has(c.id) && signedForAccount(c) === line.amount && Math.abs(Date.parse(c.date) - t) <= days * 86_400_000)
    .sort((a, b) => Math.abs(Date.parse(a.date) - t) - Math.abs(Date.parse(b.date) - t))
}

export function ruleFor(line: Pick<BankLine, 'description' | 'amount'>, rules: BankRule[]): BankRule | undefined {
  const text = line.description.toLowerCase()
  return rules.find((r) => text.includes(r.contains.toLowerCase()) && (r.direction === 'any' || (r.direction === 'in') === line.amount > 0))
}

async function updateLine(db: LedgerDB, line: BankLine, patch: Partial<BankLine>): Promise<void> {
  await db.bankLines.update(line.id, { ...patch, updatedAt: Date.now() })
  await db.track(line.companyId, 'bankLines', line.id, { fields: [...Object.keys(patch), 'updatedAt'] })
}

/** Posts a statement line as a new transaction against the chosen category. */
export async function recordBankLine(db: LedgerDB, lineId: string, input: { accountId: string; contactId?: string; memo?: string }): Promise<void> {
  await db.write(async () => {
    const line = await db.bankLines.get(lineId)
    if (!line) throw new AccountingError('Statement line not found.', 'not_found')
    if (line.status !== 'new') throw new AccountingError('This line has already been dealt with.')
    if (!input.accountId) throw new AccountingError('Choose what this transaction was for.')
    const amount = Math.abs(line.amount)
    const entry = await postGeneratedEntry(db, line.companyId, {
      date: line.date,
      memo: input.memo?.trim() || line.description,
      reference: line.reference,
      source: 'bank',
      docId: line.id,
      lines:
        line.amount > 0
          ? [{ accountId: line.accountId, debit: amount }, { accountId: input.accountId, credit: amount, contactId: input.contactId }]
          : [{ accountId: input.accountId, debit: amount, contactId: input.contactId }, { accountId: line.accountId, credit: amount }],
    })
    const bankSide = await db.journalLines.where('entryId').equals(entry.id).filter((l) => l.accountId === line.accountId).first()
    await updateLine(db, line, { status: 'recorded', journalLineId: bankSide?.id })
  })
}

export async function matchBankLine(db: LedgerDB, lineId: string, journalLineId: string): Promise<void> {
  await db.write(async () => {
    const line = await db.bankLines.get(lineId)
    const jl = await db.journalLines.get(journalLineId)
    if (!line || !jl || jl.accountId !== line.accountId) throw new AccountingError('That transaction is not on this account.')
    if (signedForAccount(jl) !== line.amount) throw new AccountingError('The amounts are different.')
    await updateLine(db, line, { status: 'matched', journalLineId })
  })
}

export async function setBankLineIgnored(db: LedgerDB, lineId: string, ignored: boolean): Promise<void> {
  await db.write(async () => {
    const line = await db.bankLines.get(lineId)
    if (!line) return
    if (!ignored && line.status === 'recorded') throw new AccountingError('This line was recorded as a transaction. Reverse that transaction instead.')
    await updateLine(db, line, { status: ignored ? 'ignored' : 'new', journalLineId: ignored || line.status !== 'matched' ? line.journalLineId : undefined })
  })
}

export async function saveBankRule(db: LedgerDB, companyId: string, input: Pick<BankRule, 'contains' | 'direction' | 'accountId' | 'contactId'>, id?: string): Promise<BankRule> {
  const contains = input.contains.trim()
  if (contains.length < 2) throw new AccountingError('Enter at least two characters to look for.')
  if (!input.accountId) throw new AccountingError('Choose an account for this rule.')
  return db.write(async () => {
    const current = id ? await db.bankRules.get(id) : undefined
    const at = Date.now()
    const rule: BankRule = { id: current?.id ?? newId(), companyId, contains, direction: input.direction, accountId: input.accountId, contactId: input.contactId || undefined, createdAt: current?.createdAt ?? at, updatedAt: at }
    await db.bankRules.put(rule)
    await db.track(companyId, 'bankRules', rule.id)
    return rule
  })
}

export async function deleteBankRule(db: LedgerDB, id: string): Promise<void> {
  await db.write(async () => {
    const rule = await db.bankRules.get(id)
    if (!rule) return
    await db.bankRules.delete(id)
    await db.track(rule.companyId, 'bankRules', id, { op: 'delete' })
  })
}

// ---------- Reconciliation ----------

export const naturalAmount = (account: Pick<Account, 'type'>, l: Pick<JournalLine, 'debit' | 'credit'>) => (isDebitNormal(account.type) ? l.debit - l.credit : l.credit - l.debit)

export function reconciledLineIds(recs: Reconciliation[]): Set<string> {
  return new Set(recs.filter((r) => r.status === 'completed').flatMap((r) => r.clearedLineIds))
}

/** Statement balance the next reconciliation starts from. */
export function openingReconciledBalance(recs: Reconciliation[]): number {
  const done = recs.filter((r) => r.status === 'completed').sort((a, b) => b.statementDate.localeCompare(a.statementDate) || (b.completedAt ?? 0) - (a.completedAt ?? 0))
  return done[0]?.statementBalance ?? 0
}

export async function saveReconciliation(
  db: LedgerDB,
  companyId: string,
  input: { id?: string; accountId: string; statementDate: string; statementBalance: number; clearedLineIds: string[] },
): Promise<Reconciliation> {
  if (!isISODate(input.statementDate)) throw new AccountingError('Enter the statement date.')
  return db.write(async () => {
    const current = input.id ? await db.reconciliations.get(input.id) : undefined
    if (current?.status === 'completed') throw new AccountingError('This reconciliation is already finished.')
    const at = Date.now()
    const rec: Reconciliation = {
      id: current?.id ?? newId(),
      companyId,
      accountId: input.accountId,
      statementDate: input.statementDate,
      statementBalance: input.statementBalance,
      clearedLineIds: [...new Set(input.clearedLineIds)],
      status: 'in_progress',
      createdAt: current?.createdAt ?? at,
      updatedAt: at,
    }
    await db.reconciliations.put(rec)
    await db.track(companyId, 'reconciliations', rec.id)
    return rec
  })
}

export async function completeReconciliation(db: LedgerDB, id: string): Promise<void> {
  await db.write(async () => {
    const rec = await db.reconciliations.get(id)
    if (!rec) throw new AccountingError('Reconciliation not found.', 'not_found')
    const account = await db.accounts.get(rec.accountId)
    if (!account) throw new AccountingError('Account not found.', 'not_found')
    const all = await db.reconciliations.where('accountId').equals(rec.accountId).toArray()
    const lines = await db.journalLines.bulkGet(rec.clearedLineIds)
    const cleared = lines.reduce((s, l) => s + (l ? naturalAmount(account, l) : 0), 0)
    const difference = rec.statementBalance - (openingReconciledBalance(all) + cleared)
    if (difference !== 0) throw new AccountingError("The cleared balance doesn't match the statement yet.")
    await db.reconciliations.update(id, { status: 'completed', completedAt: Date.now(), updatedAt: Date.now() })
    await db.track(rec.companyId, 'reconciliations', id, { fields: ['status', 'completedAt', 'updatedAt'] })
    await db.logAudit(rec.companyId, 'reconcile', 'account', rec.accountId, `Reconciled ${account.name} to ${rec.statementDate}`)
  })
}

/** Reopens the most recent finished reconciliation for an account. */
export async function undoReconciliation(db: LedgerDB, accountId: string): Promise<void> {
  await db.write(async () => {
    const done = (await db.reconciliations.where('accountId').equals(accountId).toArray())
      .filter((r) => r.status === 'completed')
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    const last = done[0]
    if (!last) throw new AccountingError('There is no finished reconciliation to undo.')
    await db.reconciliations.update(last.id, { status: 'in_progress', completedAt: undefined, updatedAt: Date.now() })
    await db.track(last.companyId, 'reconciliations', last.id, { fields: ['status', 'completedAt', 'updatedAt'] })
  })
}
