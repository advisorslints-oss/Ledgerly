import { describe, expect, it } from 'vitest'
import { setLockDate } from './company'
import { checkEntry, postEntry, reverseEntry, setOpeningBalances } from './engine'
import { AccountingError } from './errors'
import { loadAccounts, loadLines, computeTrialBalance } from './reports'
import { freshDb, setupCompany } from './test-helpers'

describe('checkEntry', () => {
  const account = (id: string, archived = false) =>
    [id, { id, companyId: 'c1', code: id, name: `Acct ${id}`, type: 'asset' as const, subtype: 'bank' as const, archived, createdAt: 0, updatedAt: 0 }] as const
  const accounts = new Map([account('a'), account('b'), account('x', true)])

  it('accepts a balanced entry and ignores blank rows', () => {
    const result = checkEntry(
      [{ accountId: 'a', debit: 500 }, { accountId: '' }, { accountId: 'b', credit: 500 }],
      accounts,
      'c1',
    )
    expect(result.ok).toBe(true)
    expect(result.lines).toHaveLength(2)
    expect(result.totalDebit).toBe(500)
  })

  it('rejects unbalanced entries and reports the difference', () => {
    const result = checkEntry([{ accountId: 'a', debit: 500 }, { accountId: 'b', credit: 300 }], accounts, 'c1')
    expect(result.ok).toBe(false)
    expect(result.difference).toBe(200)
  })

  it('rejects a line with both a debit and a credit', () => {
    const result = checkEntry([{ accountId: 'a', debit: 5, credit: 5 }, { accountId: 'b', credit: 0, debit: 0 }], accounts, 'c1')
    expect(result.errors.join(' ')).toMatch(/not both/)
  })

  it('rejects single-line, zero, negative, fractional and archived entries', () => {
    expect(checkEntry([{ accountId: 'a', debit: 5 }], accounts, 'c1').ok).toBe(false)
    expect(checkEntry([{ accountId: 'a', debit: -5 }, { accountId: 'b', credit: -5 }], accounts, 'c1').ok).toBe(false)
    expect(checkEntry([{ accountId: 'a', debit: 1.5 }, { accountId: 'b', credit: 1.5 }], accounts, 'c1').ok).toBe(false)
    expect(checkEntry([{ accountId: 'x', debit: 5 }, { accountId: 'b', credit: 5 }], accounts, 'c1').ok).toBe(false)
    expect(checkEntry([{ accountId: 'a', debit: 5 }, { accountId: 'b', credit: 5 }], accounts, 'other').ok).toBe(false)
  })
})

describe('posting', () => {
  it('posts an entry with sequential numbers and keeps the trial balance even', async () => {
    const db = freshDb()
    const { company, byCode } = await setupCompany(db)
    const first = await postEntry(db, {
      companyId: company.id,
      date: '2026-05-01',
      memo: 'Capital',
      lines: [
        { accountId: byCode('1010'), debit: 1_000_000 },
        { accountId: byCode('3000'), credit: 1_000_000 },
      ],
    })
    const second = await postEntry(db, {
      companyId: company.id,
      date: '2026-05-02',
      lines: [
        { accountId: byCode('6000'), debit: 250_00 },
        { accountId: byCode('6010'), debit: 50_00 },
        { accountId: byCode('1010'), credit: 300_00 },
      ],
    })
    expect(first.number).toBe('JE-0001')
    expect(second.number).toBe('JE-0002')
    expect(second.total).toBe(300_00)

    const tb = computeTrialBalance(await loadAccounts(db, company.id), await loadLines(db, company.id))
    expect(tb.totalDebit).toBe(tb.totalCredit)
    expect(tb.totalDebit).toBe(1_000_000)

    const audit = await db.audit.toArray()
    expect(audit.some((a) => a.summary.includes('JE-0001'))).toBe(true)
    expect(await db.changes.count()).toBeGreaterThan(0)
  })

  it('writes nothing when an entry is invalid', async () => {
    const db = freshDb()
    const { company, byCode } = await setupCompany(db)
    await expect(
      postEntry(db, {
        companyId: company.id,
        date: '2026-05-01',
        lines: [
          { accountId: byCode('1010'), debit: 100 },
          { accountId: byCode('3000'), credit: 99 },
        ],
      }),
    ).rejects.toBeInstanceOf(AccountingError)
    expect(await db.journalEntries.count()).toBe(0)
    expect((await db.companies.get(company.id))!.nextNumbers.journal).toBe(1)
  })

  it('blocks entries in a locked period', async () => {
    const db = freshDb()
    const { company, byCode } = await setupCompany(db)
    await setLockDate(db, company.id, '2026-03-31')
    const lines = [
      { accountId: byCode('1010'), debit: 100 },
      { accountId: byCode('3000'), credit: 100 },
    ]
    await expect(postEntry(db, { companyId: company.id, date: '2026-03-31', lines })).rejects.toMatchObject({ code: 'locked' })
    await expect(postEntry(db, { companyId: company.id, date: '2026-04-01', lines })).resolves.toBeTruthy()
  })
})

describe('reversals', () => {
  it('mirrors the original so balances return to zero', async () => {
    const db = freshDb()
    const { company, byCode } = await setupCompany(db)
    const entry = await postEntry(db, {
      companyId: company.id,
      date: '2026-05-01',
      lines: [
        { accountId: byCode('6000'), debit: 700 },
        { accountId: byCode('1010'), credit: 700 },
      ],
    })
    const reversal = await reverseEntry(db, entry.id, '2026-05-03')
    expect(reversal.reversalOfId).toBe(entry.id)
    expect((await db.journalEntries.get(entry.id))!.status).toBe('reversed')

    const tb = computeTrialBalance(await loadAccounts(db, company.id), await loadLines(db, company.id))
    expect(tb.rows).toHaveLength(0)

    await expect(reverseEntry(db, entry.id, '2026-05-04')).rejects.toMatchObject({ code: 'conflict' })
    await expect(reverseEntry(db, reversal.id, '2026-05-04')).rejects.toMatchObject({ code: 'conflict' })
  })

  it('refuses a reversal dated before the original', async () => {
    const db = freshDb()
    const { company, byCode } = await setupCompany(db)
    const entry = await postEntry(db, {
      companyId: company.id,
      date: '2026-05-10',
      lines: [
        { accountId: byCode('6000'), debit: 700 },
        { accountId: byCode('1010'), credit: 700 },
      ],
    })
    await expect(reverseEntry(db, entry.id, '2026-05-09')).rejects.toBeInstanceOf(AccountingError)
  })
})

describe('opening balances', () => {
  it('offsets the difference to Opening Balance Equity and replaces earlier openings', async () => {
    const db = freshDb()
    const { company, byCode } = await setupCompany(db)
    await setOpeningBalances(db, company.id, '2026-04-01', [
      { accountId: byCode('1010'), amount: 50_000 },
      { accountId: byCode('2500'), amount: 20_000 },
    ])
    let lines = await loadLines(db, company.id)
    const obe = byCode('3950')
    expect(lines.find((l) => l.accountId === obe)?.credit).toBe(30_000)

    await setOpeningBalances(db, company.id, '2026-04-01', [{ accountId: byCode('1010'), amount: 80_000 }])
    lines = await loadLines(db, company.id)
    const accounts = await loadAccounts(db, company.id)
    const tb = computeTrialBalance(accounts, lines)
    const bank = tb.rows.find((r) => r.account.code === '1010')!
    expect(bank.debit).toBe(80_000)
    expect(tb.rows.find((r) => r.account.code === '2500')).toBeUndefined()
    expect(tb.totalDebit).toBe(tb.totalCredit)

    const openings = (await db.journalEntries.toArray()).filter((e) => e.source === 'opening' && e.status === 'posted')
    expect(openings).toHaveLength(1)
  })
})
