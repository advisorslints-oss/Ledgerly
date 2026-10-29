import { COMPANY_TABLES, type LedgerDB } from '../db/database'
import type { Account, Company, Features, IndustryId, TaxComponent, TaxRate } from '../db/types'
import { isISODate } from '../lib/dates'
import { newId } from '../lib/id'
import { getCountry } from './countries'
import { AccountingError } from './errors'
import { buildChart, INVENTORY_SEED } from './templates'

export interface CompanySetup {
  name: string
  country: string
  currency: string
  industry: IndustryId
  fiscalYearStartMonth: number
  features: Features
  isDemo?: boolean
}

export async function createCompany(db: LedgerDB, setup: CompanySetup): Promise<Company> {
  const name = setup.name.trim()
  if (!name) throw new AccountingError('Enter your business name.')
  const country = getCountry(setup.country)

  return db.write(async () => {
    const at = Date.now()
    const company: Company = {
      id: newId(),
      name,
      industry: setup.industry,
      country: country.code,
      currency: setup.currency,
      locale: country.locale,
      taxName: country.taxName,
      fiscalYearStartMonth: setup.fiscalYearStartMonth,
      features: setup.features,
      nextNumbers: { journal: 1 },
      isDemo: setup.isDemo,
      createdAt: at,
      updatedAt: at,
    }
    const accounts: Account[] = buildChart(setup.industry, country.taxAccounts, setup.features).map((seed) => ({
      id: newId(),
      companyId: company.id,
      ...seed,
      archived: false,
      createdAt: at,
      updatedAt: at,
    }))
    const byCode = new Map(accounts.map((acc) => [acc.code, acc.id]))
    const taxRates: TaxRate[] = country.taxRates.map((t) => ({
      id: newId(),
      companyId: company.id,
      name: t.name,
      rate: t.components.reduce((s, c) => s + c.rate, 0),
      components: t.components.map((c) => ({
        name: c.name,
        rate: c.rate,
        salesAccountId: c.salesCode ? byCode.get(c.salesCode) : undefined,
        purchaseAccountId: c.purchaseCode ? byCode.get(c.purchaseCode) : undefined,
      })),
      archived: false,
      createdAt: at,
      updatedAt: at,
    }))

    await db.companies.add(company)
    await db.accounts.bulkAdd(accounts)
    await db.taxRates.bulkAdd(taxRates)
    await db.track(company.id, 'companies', company.id)
    await db.track(company.id, 'accounts', accounts.map((x) => x.id))
    await db.track(company.id, 'taxRates', taxRates.map((x) => x.id))
    await db.logAudit(company.id, 'create', 'company', company.id, `Created ${name} with ${accounts.length} accounts`)
    return company
  })
}

export type CompanyPatch = Partial<
  Pick<
    Company,
    | 'name'
    | 'legalName'
    | 'taxId'
    | 'address'
    | 'email'
    | 'phone'
    | 'fiscalYearStartMonth'
    | 'features'
    | 'taxName'
    | 'currency'
    | 'locale'
    | 'documentSettings'
  >
>

export async function updateCompany(db: LedgerDB, id: string, patch: CompanyPatch): Promise<void> {
  await db.write(async () => {
    const current = await db.companies.get(id)
    if (!current) throw new AccountingError('Company not found.', 'not_found')
    if (patch.name !== undefined && !patch.name.trim()) throw new AccountingError('Enter your business name.')
    if (patch.currency && patch.currency !== current.currency) {
      const entries = await db.journalEntries.where('companyId').equals(id).count()
      if (entries) throw new AccountingError("The currency can't change once transactions have been recorded.", 'conflict')
    }

    // Turning on inventory tracking needs an inventory account to post stock to.
    if (patch.features?.inventory && !current.features.inventory) {
      const existing = await db.accounts.where('companyId').equals(id).filter((a) => a.subtype === 'inventory').count()
      if (!existing) {
        const at = Date.now()
        const taken = await db.accounts.where('[companyId+code]').equals([id, INVENTORY_SEED.code]).count()
        const account: Account = {
          id: newId(),
          companyId: id,
          ...INVENTORY_SEED,
          code: taken ? '1290' : INVENTORY_SEED.code,
          archived: false,
          createdAt: at,
          updatedAt: at,
        }
        await db.accounts.add(account)
        await db.track(id, 'accounts', account.id)
      }
    }

    const clean: CompanyPatch = { ...patch }
    for (const key of ['name', 'legalName', 'taxId', 'address', 'email', 'phone', 'taxName'] as const) {
      if (typeof clean[key] === 'string') clean[key] = clean[key].trim()
    }
    await db.companies.update(id, { ...clean, updatedAt: Date.now() })
    await db.track(id, 'companies', id, { fields: [...Object.keys(clean), 'updatedAt'] })
    await db.logAudit(id, 'update', 'company', id, 'Updated company settings')
  })
}

export async function setLockDate(db: LedgerDB, id: string, lockDate: string | undefined): Promise<void> {
  if (lockDate && !isISODate(lockDate)) throw new AccountingError('Enter a valid date.')
  await db.write(async () => {
    await db.companies.update(id, { lockDate: lockDate || undefined, updatedAt: Date.now() })
    await db.track(id, 'companies', id, { fields: ['lockDate', 'updatedAt'] })
    await db.logAudit(id, 'lock', 'company', id, lockDate ? `Locked the books up to ${lockDate}` : 'Removed the lock date')
  })
}

/** Removes a company and everything recorded under it from this device. */
export async function deleteCompany(db: LedgerDB, id: string): Promise<void> {
  // Removing a business from a device is not a change to sync, so this skips the outbox.
  await db.transaction('rw', db.tables, async () => {
    for (const table of COMPANY_TABLES) await db.table(table).where('companyId').equals(id).delete()
    await db.audit.where('[companyId+at]').between([id, 0], [id, Infinity]).delete()
    await db.changes.where('companyId').equals(id).delete()
    await db.companies.delete(id)
  })
}

export interface TaxRateInput {
  name: string
  components: TaxComponent[]
}

function cleanTaxRate(input: TaxRateInput): TaxRateInput {
  const name = input.name.trim()
  if (!name) throw new AccountingError('Enter a name for the tax rate.')
  const components = input.components
    .map((c) => ({ ...c, name: c.name.trim() }))
    .filter((c) => c.name || c.rate)
  for (const c of components) {
    if (!c.name) throw new AccountingError('Give every tax component a name.')
    if (!Number.isFinite(c.rate) || c.rate < 0 || c.rate > 100) throw new AccountingError(`Enter a rate between 0 and 100 for ${c.name}.`)
    if (c.rate > 0 && !c.salesAccountId) throw new AccountingError(`Choose the account that collects ${c.name}.`)
  }
  return { name, components }
}

export async function saveTaxRate(db: LedgerDB, companyId: string, input: TaxRateInput, id?: string): Promise<TaxRate> {
  const clean = cleanTaxRate(input)
  return db.write(async () => {
    const at = Date.now()
    const current = id ? await db.taxRates.get(id) : undefined
    const rate: TaxRate = {
      id: current?.id ?? newId(),
      companyId,
      name: clean.name,
      components: clean.components,
      rate: Math.round(clean.components.reduce((s, c) => s + c.rate, 0) * 1000) / 1000,
      archived: current?.archived ?? false,
      createdAt: current?.createdAt ?? at,
      updatedAt: at,
    }
    await db.taxRates.put(rate)
    await db.track(companyId, 'taxRates', rate.id, current ? { fields: ['name', 'components', 'rate', 'updatedAt'] } : {})
    await db.logAudit(companyId, current ? 'update' : 'create', 'taxRate', rate.id, `${current ? 'Updated' : 'Added'} tax rate ${rate.name}`)
    return rate
  })
}

export async function setTaxRateArchived(db: LedgerDB, id: string, archived: boolean): Promise<void> {
  await db.write(async () => {
    const current = await db.taxRates.get(id)
    if (!current) return
    await db.taxRates.update(id, { archived, updatedAt: Date.now() })
    await db.track(current.companyId, 'taxRates', id, { fields: ['archived', 'updatedAt'] })
    await db.logAudit(current.companyId, archived ? 'archive' : 'restore', 'taxRate', id, `${archived ? 'Archived' : 'Restored'} tax rate ${current.name}`)
  })
}
