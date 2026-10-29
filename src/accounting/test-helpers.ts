import 'fake-indexeddb/auto'
import { LedgerDB } from '../db/database'
import { createCompany } from './company'

let counter = 0

export function freshDb(): LedgerDB {
  return new LedgerDB(`test-${Date.now()}-${counter++}`)
}

export async function setupCompany(db: LedgerDB, overrides: Partial<Parameters<typeof createCompany>[1]> = {}) {
  const company = await createCompany(db, {
    name: 'Test Co',
    country: 'IN',
    currency: 'INR',
    industry: 'general',
    fiscalYearStartMonth: 4,
    features: { inventory: false, projects: false },
    ...overrides,
  })
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray()
  const byCode = (code: string) => {
    const account = accounts.find((a) => a.code === code)
    if (!account) throw new Error(`No account ${code}`)
    return account.id
  }
  return { company, accounts, byCode }
}
