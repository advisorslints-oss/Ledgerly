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

/** How invoices, quotes and other documents look and what they say by default. */
export interface DocumentSettings {
  logo?: string
  accent?: string
  paymentTermsDays?: number
  quoteValidityDays?: number
  invoiceNotes?: string
  invoiceTerms?: string
  bankDetails?: string
  reminders?: ReminderSettings
  payments?: PaymentSettings
}

/** How customers can pay online. Links are built per invoice, so the amount and number are filled in. */
export interface PaymentSettings {
  /** UPI ID (India), e.g. shop@okhdfc. */
  upiId?: string
  /** Name shown in the customer's UPI app. Defaults to the business name. */
  upiName?: string
  /** A payment page link. {amount}, {currency} and {number} are filled in for each invoice. */
  link?: string
  /** Print a QR code on invoices. */
  showQr?: boolean
}

export type ReminderTone = 'gentle' | 'firm' | 'final'

export interface ReminderStage {
  /** Days relative to the due date: -3 is three days before, 7 is a week late. */
  days: number
  tone: ReminderTone
}

export interface ReminderSettings {
  enabled: boolean
  stages: ReminderStage[]
  templates: Record<ReminderTone, string>
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
  /** Next sequence number per series: journal, invoice, bill, payment_in… */
  nextNumbers: { journal: number } & Record<string, number>
  documentSettings?: DocumentSettings
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

export type EntrySource = 'manual' | 'opening' | 'reversal' | 'document' | 'payment' | 'stock' | 'bank'

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
  /** The invoice, bill, payment or other record this entry was generated from. */
  docId?: string
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
  contactId?: string
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

export type ContactType = 'customer' | 'supplier' | 'both'

export interface Contact {
  id: string
  companyId: string
  type: ContactType
  name: string
  contactPerson?: string
  email?: string
  phone?: string
  taxId?: string
  address?: string
  shippingAddress?: string
  paymentTermsDays?: number
  notes?: string
  archived: boolean
  createdAt: number
  updatedAt: number
}

export interface Item {
  id: string
  companyId: string
  kind: 'product' | 'service'
  name: string
  sku?: string
  unit?: string
  description?: string
  /** Price per unit in minor units. */
  salePrice: number
  purchasePrice: number
  salesAccountId?: string
  purchaseAccountId?: string
  salesTaxRateId?: string
  purchaseTaxRateId?: string
  trackStock: boolean
  inventoryAccountId?: string
  reorderLevel?: number
  archived: boolean
  createdAt: number
  updatedAt: number
}

export type DocType = 'invoice' | 'quote' | 'credit_note' | 'bill' | 'purchase_order' | 'supplier_credit' | 'expense'

export type DocStatus = 'draft' | 'posted' | 'void' | 'sent' | 'accepted' | 'declined' | 'converted' | 'issued' | 'cancelled'

export interface DocLine {
  id: string
  itemId?: string
  description: string
  quantity: number
  /** Price per unit in minor units. */
  rate: number
  discountPct?: number
  accountId: string
  taxRateId?: string
}

export interface Allocation {
  documentId: string
  amount: number
}

/** An invoice, quote, credit note, bill, purchase order, supplier credit or expense. */
export interface Doc {
  id: string
  companyId: string
  type: DocType
  number: string
  contactId?: string
  date: string
  dueDate?: string
  reference?: string
  status: DocStatus
  lines: DocLine[]
  taxInclusive: boolean
  subtotal: number
  taxTotal: number
  total: number
  notes?: string
  terms?: string
  /** Expenses only: the cash, bank or card account the money came from. */
  paidFromAccountId?: string
  /** The journal entry this document posted, while it's posted. */
  entryId?: string
  convertedFromId?: string
  convertedToId?: string
  /** Credit notes and supplier credits: invoices or bills this credit has been applied to. */
  allocations?: Allocation[]
  /** The recurring schedule that created this document. */
  recurringId?: string
  createdAt: number
  updatedAt: number
}

export type RecurringUnit = 'week' | 'month' | 'quarter' | 'year'

/** What each generated document copies. */
export interface RecurringTemplate {
  contactId?: string
  reference?: string
  lines: DocLine[]
  taxInclusive: boolean
  notes?: string
  terms?: string
  paidFromAccountId?: string
  /** Due date is this many days after the document date. */
  dueInDays: number
}

/** A schedule that creates an invoice, bill or expense every week, month, quarter or year. */
export interface Recurring {
  id: string
  companyId: string
  name: string
  docType: 'invoice' | 'bill' | 'expense'
  template: RecurringTemplate
  every: number
  unit: RecurringUnit
  startDate: string
  /** Which occurrence comes next (0 = the start date). Dates are worked out from the start, so months never drift. */
  nextIndex: number
  endDate?: string
  maxCount?: number
  /** Approve (post) each document straight away, or leave it as a draft to review. */
  autoApprove: boolean
  status: 'active' | 'paused' | 'ended'
  createdCount: number
  lastDate?: string
  createdAt: number
  updatedAt: number
}

/** A payment reminder sent (or marked as sent) for an invoice. */
export interface Reminder {
  id: string
  companyId: string
  documentId: string
  contactId?: string
  /** Index into the reminder stages it covered. */
  stage: number
  channel: 'email' | 'whatsapp' | 'copy' | 'manual'
  sentAt: number
}

export interface Payment {
  id: string
  companyId: string
  direction: 'in' | 'out'
  number: string
  contactId: string
  date: string
  amount: number
  /** Cash or bank account the money went into (in) or came out of (out). */
  accountId: string
  reference?: string
  notes?: string
  allocations: Allocation[]
  status: 'posted' | 'void'
  entryId?: string
  createdAt: number
  updatedAt: number
}

export interface StockMove {
  id: string
  companyId: string
  itemId: string
  date: string
  /** Positive for stock in, negative for stock out. Up to 4 decimal places. */
  quantity: number
  /** Cost per unit in minor units, for display. */
  unitCost: number
  /** Signed value in minor units: exactly what was posted to the inventory account. */
  value: number
  sourceType: 'document' | 'adjustment'
  sourceId: string
  createdAt: number
}

export interface BankLine {
  id: string
  companyId: string
  accountId: string
  date: string
  description: string
  /** Signed: positive is money in, negative is money out. */
  amount: number
  reference?: string
  status: 'new' | 'matched' | 'recorded' | 'ignored'
  /** The journal line this statement line was matched to or recorded as. */
  journalLineId?: string
  importBatch: string
  createdAt: number
  updatedAt: number
}

export interface BankRule {
  id: string
  companyId: string
  contains: string
  direction: 'in' | 'out' | 'any'
  accountId: string
  contactId?: string
  createdAt: number
  updatedAt: number
}

export interface Reconciliation {
  id: string
  companyId: string
  accountId: string
  statementDate: string
  statementBalance: number
  /** Journal lines ticked off against the statement. */
  clearedLineIds: string[]
  status: 'in_progress' | 'completed'
  completedAt?: number
  createdAt: number
  updatedAt: number
}

export interface Attachment {
  id: string
  companyId: string
  parentId: string
  name: string
  type: string
  size: number
  data: Blob
  /** Synced from another device but the file itself hasn't downloaded yet. */
  missing?: boolean
  createdAt: number
}

/** Outbox of local writes, replayed to the sync server when the device is online. */
export interface ChangeRecord {
  seq?: number
  /** All changes from one save share a batch, so the server applies them together. */
  batch: string
  companyId: string
  table: string
  key: string
  op: 'put' | 'delete'
  /** For updates of existing records: which fields changed. */
  fields?: string[]
  /** The record as it was right after this save. */
  data?: unknown
  at: number
  deviceId: string
}

export interface MetaRecord {
  key: string
  value: unknown
}
