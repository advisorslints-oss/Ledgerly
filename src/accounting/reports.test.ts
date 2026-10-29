import { describe, expect, it } from 'vitest'
import { fiscalYearStart, today } from '../lib/dates'
import { createDemoCompany } from './demo'
import { postEntry } from './engine'
import { computeBalanceSheet, computeProfitLoss, computeTrialBalance, loadAccounts, loadLines, monthlyResults } from './reports'
import { freshDb, setupCompany } from './test-helpers'

describe('financial statements', () => {
  it('produces a P&L and a balance sheet that balances across fiscal years', async () => {
    const db = freshDb()
    const { company, byCode } = await setupCompany(db)
    const post = (date: string, dr: string, cr: string, amount: number) =>
      postEntry(db, {
        companyId: company.id,
        date,
        lines: [
          { accountId: byCode(dr), debit: amount },
          { accountId: byCode(cr), credit: amount },
        ],
      })

    await post('2026-01-05', '1010', '3000', 100_000) // capital
    await post('2026-02-10', '1010', '4000', 40_000) // sale, prior FY (FY starts April)
    await post('2026-03-01', '6000', '1010', 15_000) // rent, prior FY
    await post('2026-04-10', '1100', '4000', 30_000) // credit sale, current FY
    await post('2026-04-12', '5000', '2000', 12_000) // cost on credit
    await post('2026-04-20', '7000', '1010', 1_000) // interest

    const accounts = await loadAccounts(db, company.id)
    const fyLines = await loadLines(db, company.id, '2026-04-01', '2027-03-31')
    const pl = computeProfitLoss(accounts, fyLines)
    expect(pl.income.total).toBe(30_000)
    expect(pl.costOfSales.total).toBe(12_000)
    expect(pl.grossProfit).toBe(18_000)
    expect(pl.otherExpenses.total).toBe(1_000)
    expect(pl.netProfit).toBe(17_000)

    const all = await loadLines(db, company.id, undefined, '2026-04-30')
    const bs = computeBalanceSheet(accounts, all, fiscalYearStart('2026-04-30', 4))
    expect(bs.difference).toBe(0)
    expect(bs.totalAssets).toBe(100_000 + 40_000 - 15_000 + 30_000 - 1_000)
    expect(bs.totalLiabilities).toBe(12_000)
    const labels = Object.fromEntries(bs.equity.rows.map((r) => [r.id, r.amount]))
    expect(labels.prior_earnings).toBe(25_000)
    expect(labels.current_earnings).toBe(17_000)
  })

  it('groups income and expenses by month', async () => {
    const db = freshDb()
    const { company, byCode } = await setupCompany(db)
    await postEntry(db, {
      companyId: company.id,
      date: '2026-06-03',
      lines: [
        { accountId: byCode('1010'), debit: 900 },
        { accountId: byCode('4000'), credit: 900 },
      ],
    })
    await postEntry(db, {
      companyId: company.id,
      date: '2026-07-03',
      lines: [
        { accountId: byCode('6000'), debit: 400 },
        { accountId: byCode('1010'), credit: 400 },
      ],
    })
    const points = monthlyResults(await loadAccounts(db, company.id), await loadLines(db, company.id), ['2026-06-01', '2026-07-01'])
    expect(points).toEqual([
      { month: '2026-06-01', income: 900, expenses: 0, profit: 900 },
      { month: '2026-07-01', income: 0, expenses: 400, profit: -400 },
    ])
  })
})

describe('demo company', () => {
  it.each(['IN', 'US', 'AE', 'GB'])('builds balanced books for %s', async (country) => {
    const db = freshDb()
    const company = await createDemoCompany(db, country)
    const accounts = await loadAccounts(db, company.id)
    const lines = await loadLines(db, company.id)
    expect(lines.length).toBeGreaterThan(100)

    const tb = computeTrialBalance(accounts, lines)
    expect(tb.totalDebit).toBe(tb.totalCredit)
    const bs = computeBalanceSheet(accounts, lines, fiscalYearStart(today(), company.fiscalYearStartMonth))
    expect(bs.difference).toBe(0)
    expect(lines.every((l) => l.date <= today())).toBe(true)

    const cash = tb.rows.find((r) => r.account.code === '1000')
    expect(cash ? cash.debit : 0).toBeGreaterThanOrEqual(0)
  })
})
