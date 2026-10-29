import { describe, expect, it } from 'vitest'
import {
  completeReconciliation,
  findMatches,
  guessColumns,
  guessDateFormat,
  importStatement,
  mapRows,
  matchBankLine,
  parseCsv,
  parseStatementDate,
  recordBankLine,
  ruleFor,
  saveReconciliation,
} from './banking'
import { postEntry } from './engine'
import { agingReport, cashFlow, taxSummary } from './insights'
import { loadAccounts, loadLines } from './reports'
import { freshDb, setupCompany } from './test-helpers'

describe('statement files', () => {
  it('parses quoted CSV and guesses columns', () => {
    const rows = parseCsv('﻿Date,Narration,Withdrawal,Deposit\r\n05/10/2026,"Rent, October",15000.00,\r\n06/10/2026,Cash deposit,,"2,500.50"\r\n')
    expect(rows).toHaveLength(3)
    expect(rows[1][1]).toBe('Rent, October')
    const cols = guessColumns(rows[0])
    expect(cols).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3, amount: -1 })
    const mapped = mapRows(rows.slice(1), cols, guessDateFormat(['05/10/2026', '26/10/2026'], 'mdy'), 2)
    expect(mapped.rows).toEqual([
      { date: '2026-10-05', description: 'Rent, October', amount: -1_500_000, reference: undefined },
      { date: '2026-10-06', description: 'Cash deposit', amount: 250_050, reference: undefined },
    ])
  })

  it('reads many date styles', () => {
    expect(parseStatementDate('2026-10-05', 'dmy')).toBe('2026-10-05')
    expect(parseStatementDate('10/05/26', 'mdy')).toBe('2026-10-05')
    expect(parseStatementDate('5 Oct 2026', 'mdy')).toBe('2026-10-05')
    expect(parseStatementDate('Oct 5, 2026', 'dmy')).toBe('2026-10-05')
    expect(parseStatementDate('05.10.2026 14:22', 'dmy')).toBe('2026-10-05')
    expect(parseStatementDate('31/02/2026', 'dmy')).toBeNull()
  })

  it('matches rules by description and direction', () => {
    const rules = [{ id: 'r', companyId: 'c', contains: 'uber', direction: 'out' as const, accountId: 'travel', createdAt: 0, updatedAt: 0 }]
    expect(ruleFor({ description: 'UBER *TRIP', amount: -500 }, rules)?.accountId).toBe('travel')
    expect(ruleFor({ description: 'UBER refund', amount: 500 }, rules)).toBeUndefined()
  })
})

describe('bank review and reconciliation', () => {
  it('imports without duplicates, records, matches and reconciles', async () => {
    const db = freshDb()
    const { company, byCode } = await setupCompany(db)
    const bank = byCode('1010')
    await postEntry(db, { companyId: company.id, date: '2026-05-01', memo: 'Capital', lines: [{ accountId: bank, debit: 100_000 }, { accountId: byCode('3000'), credit: 100_000 }] })

    const rows = [
      { date: '2026-05-01', description: 'OWNER TRANSFER', amount: 100_000 },
      { date: '2026-05-03', description: 'UBER TRIP', amount: -2_000 },
    ]
    expect(await importStatement(db, company.id, bank, rows)).toEqual({ added: 2, duplicates: 0 })
    expect(await importStatement(db, company.id, bank, rows)).toEqual({ added: 0, duplicates: 2 })

    const lines = await db.bankLines.toArray()
    const transfer = lines.find((l) => l.amount === 100_000)!
    const uber = lines.find((l) => l.amount === -2_000)!
    const candidates = await db.journalLines.where('[accountId+date]').between([bank, ''], [bank, '￿']).toArray()
    const [match] = findMatches(transfer, candidates, new Set())
    await matchBankLine(db, transfer.id, match.id)
    await recordBankLine(db, uber.id, { accountId: byCode('6070') })

    const bankLines = await db.journalLines.where('[accountId+date]').between([bank, ''], [bank, '￿']).toArray()
    expect(bankLines.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(98_000)

    const rec = await saveReconciliation(db, company.id, { accountId: bank, statementDate: '2026-05-31', statementBalance: 98_000, clearedLineIds: [bankLines[0].id] })
    await expect(completeReconciliation(db, rec.id)).rejects.toThrow(/doesn't match/)
    await saveReconciliation(db, company.id, { id: rec.id, accountId: bank, statementDate: '2026-05-31', statementBalance: 98_000, clearedLineIds: bankLines.map((l) => l.id) })
    await completeReconciliation(db, rec.id)
    expect((await db.reconciliations.get(rec.id))!.status).toBe('completed')
  })
})

describe('insight reports', () => {
  it('splits cash flow by activity and ties to the change in cash', async () => {
    const db = freshDb()
    const { company, byCode } = await setupCompany(db)
    const bank = byCode('1010')
    const post = (date: string, dr: string, cr: string, amount: number) =>
      postEntry(db, { companyId: company.id, date, lines: [{ accountId: byCode(dr), debit: amount }, { accountId: byCode(cr), credit: amount }] })
    await post('2026-04-01', '1010', '3000', 50_000)
    await post('2026-05-01', '1010', '4000', 20_000)
    await post('2026-05-02', '6000', '1010', 5_000)
    await post('2026-05-03', '1510', '1010', 8_000)
    await post('2026-05-04', '1010', '2500', 10_000)
    await post('2026-05-05', '1000', '1010', 1_000)

    const accounts = await loadAccounts(db, company.id)
    const cf = cashFlow(accounts, await loadLines(db, company.id, '2026-05-01', '2026-05-31'), await loadLines(db, company.id, undefined, '2026-04-30'))
    expect(cf.sections.operating.total).toBe(15_000)
    expect(cf.sections.investing.total).toBe(-8_000)
    expect(cf.sections.financing.total).toBe(10_000)
    expect(cf.opening).toBe(50_000)
    expect(cf.closing).toBe(67_000)
    expect(bank).toBeTruthy()
  })

  it('ages unpaid invoices into buckets and sums tax', async () => {
    const docs = [
      { id: 'a', type: 'invoice', status: 'posted', date: '2026-01-01', dueDate: '2026-01-31', total: 1000, contactId: 'x' },
      { id: 'b', type: 'invoice', status: 'posted', date: '2026-03-01', dueDate: '2026-03-31', total: 500, contactId: 'x' },
      { id: 'c', type: 'invoice', status: 'posted', date: '2026-04-20', dueDate: '2026-05-20', total: 300, contactId: 'y' },
    ] as never[]
    const contacts = new Map([
      ['x', { name: 'X' }],
      ['y', { name: 'Y' }],
    ]) as never
    const r = agingReport(docs, new Map([['b', 200]]), 'invoice', '2026-04-30', contacts)
    expect(r.totals).toMatchObject({ current: 300, d30: 300, d60: 0, d90: 1000, older: 0, total: 1600 })

    const db = freshDb()
    const { company, accounts } = await setupCompany(db)
    const out = accounts.find((a) => a.code === '2210')!
    const inp = accounts.find((a) => a.code === '1360')!
    const t = taxSummary(accounts, [
      { accountId: out.id, debit: 0, credit: 900 },
      { accountId: inp.id, debit: 400, credit: 0 },
    ])
    expect(t.net).toBe(500)
    expect(company).toBeTruthy()
  })
})
