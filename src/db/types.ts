export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'

export type AccountSubtype =
  | 'cash'
  | 'bank'
  | 'receivable'
  | 'inventory'
  | 'tax_receivable'
  | 'current_asset'
  | 'fixed_asset'
  | 'other_asset'
  | 'payable'
  | 'credit_card'
  | 'tax_payable'
  | 'current_liability'
  | 'long_term_liability'
  | 'equity'
  | 'retained_earnings'
  | 'sales'
  | 'other_income'
  | 'cost_of_sales'
  | 'operating_expense'
  | 'other_expense'

/** Accounts the app relies on for automatic postings. They can be renamed but not archived. */
export type SystemKey =
  | 'cash'
  | 'bank'
  | 'accounts_receivable'
  | 'accounts_payable'
  | 'inventory'
  | 'retained_earnings'
  | 'opening_balance'
  | 'sales'
  | 'cogs'

export type IndustryId =
  | 'general'
  | 'services'
  | 'retail'
  | 'manufacturing'
  | 'restaurant'
  | 'construction'
  | 'healthcare'
  | 'education'
  | 'nonprofit'
  | 'realestate'
  | 'logistics'
  | 'agriculture'

export interface Features {
  inventory: boolean
  projects: boolean
}

export interface Company {
  id: string
  name: string
  legalName?: string
  taxId?: string
  address?: string
  email?: string
  phone?: string
  industry: IndustryId
  country: string
  currency: string
  locale: string
  taxName: string
  fiscalYearStartMonth: number
  /** Entries dated on or before this date can't be added, changed or reversed. */
  lockDate?: string
  features: Features
  nextNumbers: { journal: number }
  lastBackupAt?: number
  isDemo?: boolean
  createdAt: number
  updatedAt: number
}

export interface Account {
  id: string
  companyId: string
  code: string
  name: string
  type: AccountType
  subtype: AccountSubtype
  description?: string
  systemKey?: SystemKey
  archived: boolean
  createdAt: number
  updatedAt: number
}

export type EntrySource = 'manual' | 'opening' | 'reversal'

export interface JournalEntry {
  id: string
  companyId: string
  number: string
  date: string
  memo: string
  reference?: string
  source: EntrySource
  status: 'posted' | 'reversed'
  reversalOfId?: string
  reversedById?: string
  /** Sum of the debit side, in minor units. */
  total: number
  deviceId: string
  createdAt: number
  updatedAt: number
}

export interface JournalLine {
  id: string
  companyId: string
  entryId: string
  accountId: string
  /** Copied from the entry so reports can range-scan lines by date. */
  date: string
  debit: number
  credit: number
  description?: string
  order: number
}

export interface TaxComponent {
  name: string
  /** Percentage, e.g. 9 for 9%. */
  rate: number
  /** Liability account that collects tax charged on sales. */
  salesAccountId?: string
  /** Asset account that tracks tax paid on purchases that can be claimed back. */
  purchaseAccountId?: string
}

export interface TaxRate {
  id: string
  companyId: string
  name: string
  /** Total percentage across all components. */
  rate: number
  components: TaxComponent[]
  archived: boolean
  createdAt: number
  updatedAt: number
}

export interface AuditEvent {
  id: string
  companyId: string
  at: number
  action: string
  entity: string
  entityId: string
  summary: string
  deviceId: string
}

/** Outbox of local writes, replayed to the sync server when the device is online. */
export interface ChangeRecord {
  seq?: number
  table: string
  key: string
  op: 'put' | 'delete'
  at: number
  deviceId: string
}

export interface MetaRecord {
  key: string
  value: unknown
}
