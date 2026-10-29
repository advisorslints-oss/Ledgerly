import type { AccountSubtype, AccountType, Features, IndustryId, SystemKey } from '../db/types'

export interface AccountSeed {
  code: string
  name: string
  type: AccountType
  subtype: AccountSubtype
  systemKey?: SystemKey
  description?: string
}

const a = (
  code: string,
  name: string,
  type: AccountType,
  subtype: AccountSubtype,
  extra: Partial<AccountSeed> = {},
): AccountSeed => ({ code, name, type, subtype, ...extra })

const BASE_CHART: AccountSeed[] = [
  a('1000', 'Cash on Hand', 'asset', 'cash', { systemKey: 'cash', description: 'Physical cash in the till or safe.' }),
  a('1010', 'Bank Account', 'asset', 'bank', { systemKey: 'bank', description: 'Your main business bank account.' }),
  a('1100', 'Accounts Receivable', 'asset', 'receivable', {
    systemKey: 'accounts_receivable',
    description: 'Money customers owe you for sales on credit.',
  }),
  a('1200', 'Inventory', 'asset', 'inventory', { systemKey: 'inventory', description: 'Cost of goods you hold for sale.' }),
  a('1300', 'Prepaid Expenses', 'asset', 'current_asset', { description: 'Expenses paid in advance, like annual insurance.' }),
  a('1310', 'Employee Advances', 'asset', 'current_asset'),
  a('1500', 'Furniture & Fixtures', 'asset', 'fixed_asset'),
  a('1510', 'Computers & Equipment', 'asset', 'fixed_asset'),
  a('1590', 'Accumulated Depreciation', 'asset', 'fixed_asset', {
    description: 'Total depreciation charged on fixed assets so far. Normally a negative (credit) balance.',
  }),
  a('2000', 'Accounts Payable', 'liability', 'payable', {
    systemKey: 'accounts_payable',
    description: 'Money you owe suppliers for purchases on credit.',
  }),
  a('2100', 'Credit Card', 'liability', 'credit_card'),
  a('2300', 'Salaries Payable', 'liability', 'current_liability'),
  a('2310', 'Accrued Expenses', 'liability', 'current_liability'),
  a('2400', 'Customer Deposits', 'liability', 'current_liability', { description: 'Advances received before you deliver.' }),
  a('2500', 'Loans', 'liability', 'long_term_liability'),
  a('3000', "Owner's Capital", 'equity', 'equity', { description: 'Money the owners have put into the business.' }),
  a('3100', "Owner's Drawings", 'equity', 'equity', { description: 'Money the owners have taken out for personal use.' }),
  a('3900', 'Retained Earnings', 'equity', 'retained_earnings', {
    systemKey: 'retained_earnings',
    description: 'Profits kept in the business from earlier years.',
  }),
  a('3950', 'Opening Balance Equity', 'equity', 'equity', {
    systemKey: 'opening_balance',
    description: 'Balancing figure used when you enter opening balances.',
  }),
  a('4000', 'Sales', 'income', 'sales', { systemKey: 'sales' }),
  a('4050', 'Discounts Given', 'income', 'sales', { description: 'Discounts reduce sales, so this usually has a debit balance.' }),
  a('4900', 'Other Income', 'income', 'other_income'),
  a('4910', 'Interest Income', 'income', 'other_income'),
  a('5000', 'Cost of Sales', 'expense', 'cost_of_sales', {
    systemKey: 'cogs',
    description: 'Direct costs of what you sold.',
  }),
  a('6000', 'Rent', 'expense', 'operating_expense'),
  a('6010', 'Utilities', 'expense', 'operating_expense', { description: 'Electricity, water and gas.' }),
  a('6020', 'Salaries & Wages', 'expense', 'operating_expense'),
  a('6030', 'Employee Benefits', 'expense', 'operating_expense'),
  a('6040', 'Office Supplies', 'expense', 'operating_expense'),
  a('6050', 'Internet & Phone', 'expense', 'operating_expense'),
  a('6060', 'Marketing & Advertising', 'expense', 'operating_expense'),
  a('6070', 'Travel & Transport', 'expense', 'operating_expense'),
  a('6080', 'Professional Fees', 'expense', 'operating_expense', { description: 'Accountants, lawyers and consultants.' }),
  a('6090', 'Insurance', 'expense', 'operating_expense'),
  a('6100', 'Repairs & Maintenance', 'expense', 'operating_expense'),
  a('6110', 'Bank Charges', 'expense', 'operating_expense'),
  a('6120', 'Software & Subscriptions', 'expense', 'operating_expense'),
  a('6130', 'Depreciation', 'expense', 'operating_expense'),
  a('6140', 'Licenses & Permits', 'expense', 'operating_expense'),
  a('6900', 'Miscellaneous Expenses', 'expense', 'operating_expense'),
  a('7000', 'Interest Expense', 'expense', 'other_expense'),
  a('7100', 'Income Tax Expense', 'expense', 'other_expense'),
]

export interface IndustryTemplate {
  id: IndustryId
  name: string
  description: string
  features: Features
  rename?: Record<string, string>
  remove?: string[]
  add?: AccountSeed[]
}

export const INDUSTRIES: IndustryTemplate[] = [
  {
    id: 'general',
    name: 'General business',
    description: 'A flexible setup that suits most small businesses.',
    features: { inventory: false, projects: false },
  },
  {
    id: 'services',
    name: 'Professional services',
    description: 'Consultants, agencies, freelancers, IT and design firms.',
    features: { inventory: false, projects: true },
    rename: { '4000': 'Service Revenue', '5000': 'Direct Project Costs' },
    add: [
      a('4010', 'Reimbursable Expense Income', 'income', 'sales'),
      a('5010', 'Subcontractors', 'expense', 'cost_of_sales'),
      a('6150', 'Training & Development', 'expense', 'operating_expense'),
    ],
  },
  {
    id: 'retail',
    name: 'Retail & e-commerce',
    description: 'Shops, online stores, wholesalers and distributors.',
    features: { inventory: true, projects: false },
    rename: { '4000': 'Store Sales', '5000': 'Cost of Goods Sold' },
    add: [
      a('4010', 'Online Sales', 'income', 'sales'),
      a('4060', 'Sales Returns', 'income', 'sales'),
      a('5010', 'Freight & Shipping In', 'expense', 'cost_of_sales'),
      a('5020', 'Inventory Shrinkage', 'expense', 'cost_of_sales'),
      a('6160', 'Payment Processing Fees', 'expense', 'operating_expense'),
      a('6170', 'Packaging', 'expense', 'operating_expense'),
      a('6180', 'Shipping & Delivery', 'expense', 'operating_expense'),
    ],
  },
  {
    id: 'manufacturing',
    name: 'Manufacturing',
    description: 'Factories, workshops and producers of goods.',
    features: { inventory: true, projects: false },
    remove: ['1200'],
    rename: { '5000': 'Cost of Goods Sold' },
    add: [
      a('1200', 'Raw Materials', 'asset', 'inventory'),
      a('1210', 'Work in Progress', 'asset', 'inventory'),
      a('1220', 'Finished Goods', 'asset', 'inventory', { systemKey: 'inventory' }),
      a('1520', 'Plant & Machinery', 'asset', 'fixed_asset'),
      a('5010', 'Direct Labour', 'expense', 'cost_of_sales'),
      a('5020', 'Factory Overhead', 'expense', 'cost_of_sales'),
      a('5030', 'Freight In', 'expense', 'cost_of_sales'),
    ],
  },
  {
    id: 'restaurant',
    name: 'Restaurants & hospitality',
    description: 'Cafés, restaurants, bakeries, hotels and caterers.',
    features: { inventory: true, projects: false },
    rename: { '4000': 'Food Sales', '5000': 'Food Costs' },
    add: [
      a('1520', 'Kitchen Equipment', 'asset', 'fixed_asset'),
      a('4010', 'Beverage Sales', 'income', 'sales'),
      a('4020', 'Catering & Events', 'income', 'sales'),
      a('5010', 'Beverage Costs', 'expense', 'cost_of_sales'),
      a('5020', 'Packaging & Disposables', 'expense', 'cost_of_sales'),
      a('6200', 'Delivery Platform Commissions', 'expense', 'operating_expense'),
      a('6210', 'Kitchen Supplies', 'expense', 'operating_expense'),
    ],
  },
  {
    id: 'construction',
    name: 'Construction & contracting',
    description: 'Builders, contractors, electricians, plumbers and trades.',
    features: { inventory: false, projects: true },
    rename: { '4000': 'Contract Revenue', '5000': 'Materials' },
    add: [
      a('1150', 'Retention Receivable', 'asset', 'receivable'),
      a('1520', 'Tools & Machinery', 'asset', 'fixed_asset'),
      a('1530', 'Vehicles', 'asset', 'fixed_asset'),
      a('2410', 'Retention Payable', 'liability', 'current_liability'),
      a('5010', 'Subcontractors', 'expense', 'cost_of_sales'),
      a('5020', 'Equipment Rental', 'expense', 'cost_of_sales'),
      a('5030', 'Direct Labour', 'expense', 'cost_of_sales'),
    ],
  },
  {
    id: 'healthcare',
    name: 'Healthcare & clinics',
    description: 'Clinics, dentists, pharmacies, labs and therapists.',
    features: { inventory: false, projects: false },
    rename: { '4000': 'Patient Fees', '5000': 'Medical Supplies' },
    add: [
      a('1520', 'Medical Equipment', 'asset', 'fixed_asset'),
      a('4010', 'Pharmacy Sales', 'income', 'sales'),
      a('4020', 'Insurance Reimbursements', 'income', 'sales'),
      a('5010', 'Lab Fees', 'expense', 'cost_of_sales'),
      a('6220', 'Medical Waste Disposal', 'expense', 'operating_expense'),
    ],
  },
  {
    id: 'education',
    name: 'Education & training',
    description: 'Schools, coaching centres, academies and online courses.',
    features: { inventory: false, projects: false },
    rename: { '4000': 'Tuition Fees', '5000': 'Teaching Materials' },
    add: [
      a('2420', 'Fees Received in Advance', 'liability', 'current_liability'),
      a('4010', 'Admission Fees', 'income', 'sales'),
      a('4020', 'Course Material Sales', 'income', 'sales'),
      a('5010', 'Visiting Faculty', 'expense', 'cost_of_sales'),
      a('6230', 'Events & Activities', 'expense', 'operating_expense'),
    ],
  },
  {
    id: 'nonprofit',
    name: 'Non-profits & NGOs',
    description: 'Charities, trusts, associations and community groups.',
    features: { inventory: false, projects: true },
    remove: ['3100'],
    rename: { '3000': 'Net Assets', '4000': 'Donations', '5000': 'Program Expenses' },
    add: [
      a('4010', 'Grants', 'income', 'sales'),
      a('4020', 'Membership Fees', 'income', 'sales'),
      a('4030', 'Fundraising Event Income', 'income', 'sales'),
      a('6240', 'Fundraising Expenses', 'expense', 'operating_expense'),
    ],
  },
  {
    id: 'realestate',
    name: 'Real estate & property',
    description: 'Landlords, property managers and agents.',
    features: { inventory: false, projects: false },
    rename: { '4000': 'Rental Income', '5000': 'Property Operating Costs' },
    add: [
      a('1540', 'Land & Buildings', 'asset', 'fixed_asset'),
      a('2430', 'Tenant Security Deposits', 'liability', 'current_liability'),
      a('4010', 'Commission Income', 'income', 'sales'),
      a('4020', 'Maintenance Charges Collected', 'income', 'sales'),
      a('6250', 'Property Taxes', 'expense', 'operating_expense'),
      a('6260', 'Property Management Fees', 'expense', 'operating_expense'),
    ],
  },
  {
    id: 'logistics',
    name: 'Transport & logistics',
    description: 'Trucking, couriers, fleets and travel operators.',
    features: { inventory: false, projects: false },
    rename: { '4000': 'Freight Income', '5000': 'Fuel' },
    add: [
      a('1530', 'Vehicles', 'asset', 'fixed_asset'),
      a('4010', 'Trip & Passenger Income', 'income', 'sales'),
      a('5010', 'Driver Wages', 'expense', 'cost_of_sales'),
      a('5020', 'Tolls & Permits', 'expense', 'cost_of_sales'),
      a('5030', 'Vehicle Hire', 'expense', 'cost_of_sales'),
      a('6270', 'Vehicle Maintenance', 'expense', 'operating_expense'),
    ],
  },
  {
    id: 'agriculture',
    name: 'Agriculture & farming',
    description: 'Farms, dairies, plantations and agri-businesses.',
    features: { inventory: true, projects: false },
    rename: { '4000': 'Crop Sales', '5000': 'Seeds & Fertilizer' },
    add: [
      a('1230', 'Livestock', 'asset', 'inventory'),
      a('1520', 'Farm Machinery', 'asset', 'fixed_asset'),
      a('4010', 'Livestock & Produce Sales', 'income', 'sales'),
      a('4920', 'Government Subsidies', 'income', 'other_income'),
      a('5010', 'Animal Feed', 'expense', 'cost_of_sales'),
      a('5020', 'Farm Labour', 'expense', 'cost_of_sales'),
      a('5030', 'Irrigation & Water', 'expense', 'cost_of_sales'),
    ],
  },
]

export function getIndustry(id: IndustryId): IndustryTemplate {
  return INDUSTRIES.find((i) => i.id === id) ?? INDUSTRIES[0]
}

/** The default inventory account added when inventory tracking is switched on later. */
export const INVENTORY_SEED = BASE_CHART.find((s) => s.code === '1200')!

export function buildChart(industryId: IndustryId, taxAccounts: AccountSeed[], features: Features): AccountSeed[] {
  const industry = getIndustry(industryId)
  const removed = new Set(industry.remove ?? [])
  const keep = (s: AccountSeed) => features.inventory || s.subtype !== 'inventory'
  const base = BASE_CHART.filter((s) => !removed.has(s.code) && keep(s)).map((s) =>
    industry.rename?.[s.code] ? { ...s, name: industry.rename[s.code] } : s,
  )
  const extra = (industry.add ?? []).filter(keep)
  return [...base, ...extra, ...taxAccounts].sort((x, y) => x.code.localeCompare(y.code))
}
