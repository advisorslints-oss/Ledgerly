import { describe, expect, it } from 'vitest'
import { createAccount, deleteAccount, setAccountArchived, suggestCode, updateAccount } from './accounts'
import { updateCompany } from './company'
import { COUNTRIES } from './countries'
import { postEntry } from './engine'
import { INDUSTRIES, buildChart } from './templates'
import { freshDb, setupCompany } from './test-helpers'
import { exportCompany, parseBackup, restoreBackup } from './backup'

describe('chart templates', () => {
  const required = ['cash', 'bank', 'accounts_receivable', 'accounts_payable', 'retained_earnings', 'opening_balance', 'sales', 'cogs']

  for (const industry of INDUSTRIES) {
    for (const country of COUNTRIES) {
      for (const inventory of [false, true]) {
        it(`${industry.id} / ${country.code} / inventory ${inventory}`, () => {
          const chart = buildChart(industry.id, country.taxAccounts, { inventory, projects: false })
          const codes = chart.map((a) => a.code)
          expect(new Set(codes).size).toBe(codes.length)
          const keys = chart.map((a) => a.systemKey).filter(Boolean)
          expect(new Set(keys).size).toBe(keys.length)
          for (const key of required) expect(keys).toContain(key)
          if (inventory) expect(keys).toContain('inventory')
          else expect(chart.some((a) => a.subtype === 'inventory')).toBe(false)
        })
      }
    }
  }

  it('links every seeded tax component to accounts that exist', async () => {
    for (const country of COUNTRIES) {
      const db = freshDb()
      const { company } = await setupCompany(db, { country: country.code, currency: country.currency })
      const rates = await db.taxRates.where('companyId').equals(company.id).toArray()
      expect(rates).toHaveLength(country.taxRates.length)
      for (const rate of rates) {
        for (const c of rate.components) {
          expect(c.salesAccountId, `${country.code} ${rate.name}`).toBeTruthy()
          expect(await db.accounts.get(c.salesAccountId!)).toBeTruthy()
        }
      }
    }
  })
})

describe('account management', () => {
  it('suggests the next free code in range', () => {
    expect(suggestCode([{ code: '6000' }, { code: '6010' }], 'operating_expense')).toBe('6020')
    expect(suggestCode([], 'other_asset')).toBe('1800')
    expect(suggestCode([{ code: '1009' }, { code: '1000' }], 'cash')).toBe('1001')
  })

  it('enforces unique codes and protects accounts with activity', async () => {
    const db = freshDb()
    const { company, byCode } = await setupCompany(db)
    const fuel = await createAccount(db, company.id, { code: '6300', name: 'Fuel', type: 'expense', subtype: 'operating_expense' })
    await expect(
      createAccount(db, company.id, { code: '6300', name: 'Fuel 2', type: 'expense', subtype: 'operating_expense' }),
    ).rejects.toMatchObject({ code: 'conflict' })
    await expect(
      createAccount(db, company.id, { code: '6310', name: 'fuel', type: 'expense', subtype: 'operating_expense' }),
    ).rejects.toMatchObject({ code: 'conflict' })

    await postEntry(db, {
      companyId: company.id,
      date: '2026-05-01',
      lines: [
        { accountId: fuel.id, debit: 100 },
        { accountId: byCode('1000'), credit: 100 },
      ],
    })
    await expect(updateAccount(db, fuel.id, { ...fuel, type: 'asset', subtype: 'current_asset' })).rejects.toThrow(/type can't change/)
    await expect(deleteAccount(db, fuel.id)).rejects.toMatchObject({ code: 'conflict' })
    await setAccountArchived(db, fuel.id, true)
    expect((await db.accounts.get(fuel.id))!.archived).toBe(true)

    await expect(setAccountArchived(db, byCode('1100'), true)).rejects.toThrow(/used by the app/)
  })

  it('adds an inventory account when inventory tracking is turned on', async () => {
    const db = freshDb()
    const { company } = await setupCompany(db)
    await updateCompany(db, company.id, { features: { inventory: true, projects: false } })
    const inv = await db.accounts.where('companyId').equals(company.id).filter((a) => a.subtype === 'inventory').toArray()
    expect(inv).toHaveLength(1)
  })

  it("won't change currency after transactions exist", async () => {
    const db = freshDb()
    const { company, byCode } = await setupCompany(db)
    await postEntry(db, {
      companyId: company.id,
      date: '2026-05-01',
      lines: [
        { accountId: byCode('1010'), debit: 100 },
        { accountId: byCode('3000'), credit: 100 },
      ],
    })
    await expect(updateCompany(db, company.id, { currency: 'USD' })).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('backups', () => {
  it('round-trips a company and rejects tampered files', async () => {
    const db = freshDb()
    const { company, byCode } = await setupCompany(db)
    await postEntry(db, {
      companyId: company.id,
      date: '2026-05-01',
      lines: [
        { accountId: byCode('1010'), debit: 100 },
        { accountId: byCode('3000'), credit: 100 },
      ],
    })
    const backup = await exportCompany(db, company.id)
    const text = JSON.stringify(backup)

    const other = freshDb()
    await restoreBackup(other, parseBackup(text))
    expect(await other.journalLines.count()).toBe(2)
    expect((await other.companies.get(company.id))!.name).toBe('Test Co')

    const tampered = JSON.parse(text)
    tampered.journalLines[0].debit = 999
    expect(() => parseBackup(JSON.stringify(tampered))).toThrow(/doesn't balance/)
    expect(() => parseBackup('{"hello":1}')).toThrow(/isn't a Ledgerly backup/)
  })
})
