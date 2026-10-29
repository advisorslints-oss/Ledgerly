import type { AccountSeed } from './templates'

export interface TaxSeed {
  name: string
  components: { name: string; rate: number; salesCode?: string; purchaseCode?: string }[]
}

export interface CountryPreset {
  code: string
  name: string
  currency: string
  locale: string
  fiscalYearStartMonth: number
  taxName: string
  taxIdLabel: string
  taxAccounts: AccountSeed[]
  taxRates: TaxSeed[]
}

const payable = (code: string, name: string): AccountSeed => ({ code, name, type: 'liability', subtype: 'tax_payable' })
const receivable = (code: string, name: string): AccountSeed => ({ code, name, type: 'asset', subtype: 'tax_receivable' })

/** A single-component tax (VAT, GST…) that posts to one payable and one receivable account. */
function simple(taxName: string, rates: number[], claimable = true): Pick<CountryPreset, 'taxAccounts' | 'taxRates'> {
  return {
    taxAccounts: [
      payable('2200', `${taxName} Payable`),
      ...(claimable ? [receivable('1350', `${taxName} Receivable`)] : []),
    ],
    taxRates: rates.map((rate) => ({
      name: `${taxName} ${rate}%`,
      components: [{ name: taxName, rate, salesCode: '2200', purchaseCode: claimable ? '1350' : undefined }],
    })),
  }
}

function indiaGst(): Pick<CountryPreset, 'taxAccounts' | 'taxRates'> {
  const slabs = [5, 18, 40]
  return {
    taxAccounts: [
      receivable('1360', 'Input CGST'),
      receivable('1361', 'Input SGST'),
      receivable('1362', 'Input IGST'),
      payable('2210', 'Output CGST'),
      payable('2211', 'Output SGST'),
      payable('2212', 'Output IGST'),
      payable('2220', 'TDS Payable'),
    ],
    taxRates: [
      { name: 'GST 0%', components: [] },
      ...slabs.map((rate) => ({
        name: `GST ${rate}%`,
        components: [
          { name: 'CGST', rate: rate / 2, salesCode: '2210', purchaseCode: '1360' },
          { name: 'SGST', rate: rate / 2, salesCode: '2211', purchaseCode: '1361' },
        ],
      })),
      ...slabs.map((rate) => ({
        name: `IGST ${rate}%`,
        components: [{ name: 'IGST', rate, salesCode: '2212', purchaseCode: '1362' }],
      })),
    ],
  }
}

export const COUNTRIES: CountryPreset[] = [
  { code: 'AU', name: 'Australia', currency: 'AUD', locale: 'en-AU', fiscalYearStartMonth: 7, taxName: 'GST', taxIdLabel: 'ABN', ...simple('GST', [10, 0]) },
  { code: 'BD', name: 'Bangladesh', currency: 'BDT', locale: 'en-BD', fiscalYearStartMonth: 7, taxName: 'VAT', taxIdLabel: 'BIN', ...simple('VAT', [15, 0]) },
  {
    code: 'CA',
    name: 'Canada',
    currency: 'CAD',
    locale: 'en-CA',
    fiscalYearStartMonth: 1,
    taxName: 'GST/HST',
    taxIdLabel: 'Business number',
    taxAccounts: [receivable('1350', 'GST/HST Receivable'), payable('2200', 'GST/HST Payable')],
    taxRates: [
      { name: 'GST 5%', components: [{ name: 'GST', rate: 5, salesCode: '2200', purchaseCode: '1350' }] },
      { name: 'HST 13%', components: [{ name: 'HST', rate: 13, salesCode: '2200', purchaseCode: '1350' }] },
    ],
  },
  { code: 'IN', name: 'India', currency: 'INR', locale: 'en-IN', fiscalYearStartMonth: 4, taxName: 'GST', taxIdLabel: 'GSTIN', ...indiaGst() },
  { code: 'KE', name: 'Kenya', currency: 'KES', locale: 'en-KE', fiscalYearStartMonth: 1, taxName: 'VAT', taxIdLabel: 'KRA PIN', ...simple('VAT', [16, 0]) },
  {
    code: 'MY',
    name: 'Malaysia',
    currency: 'MYR',
    locale: 'en-MY',
    fiscalYearStartMonth: 1,
    taxName: 'SST',
    taxIdLabel: 'SST registration no.',
    taxAccounts: [payable('2200', 'SST Payable')],
    taxRates: [
      { name: 'Sales tax 10%', components: [{ name: 'Sales tax', rate: 10, salesCode: '2200' }] },
      { name: 'Sales tax 5%', components: [{ name: 'Sales tax', rate: 5, salesCode: '2200' }] },
      { name: 'Service tax 8%', components: [{ name: 'Service tax', rate: 8, salesCode: '2200' }] },
    ],
  },
  { code: 'NP', name: 'Nepal', currency: 'NPR', locale: 'en-NP', fiscalYearStartMonth: 7, taxName: 'VAT', taxIdLabel: 'PAN', ...simple('VAT', [13, 0]) },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', locale: 'en-NZ', fiscalYearStartMonth: 4, taxName: 'GST', taxIdLabel: 'GST number', ...simple('GST', [15, 0]) },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', locale: 'en-NG', fiscalYearStartMonth: 1, taxName: 'VAT', taxIdLabel: 'TIN', ...simple('VAT', [7.5, 0]) },
  { code: 'PK', name: 'Pakistan', currency: 'PKR', locale: 'en-PK', fiscalYearStartMonth: 7, taxName: 'Sales Tax', taxIdLabel: 'NTN', ...simple('Sales Tax', [18, 0]) },
  { code: 'PH', name: 'Philippines', currency: 'PHP', locale: 'en-PH', fiscalYearStartMonth: 1, taxName: 'VAT', taxIdLabel: 'TIN', ...simple('VAT', [12, 0]) },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', locale: 'en-SA', fiscalYearStartMonth: 1, taxName: 'VAT', taxIdLabel: 'VAT number', ...simple('VAT', [15, 0]) },
  { code: 'SG', name: 'Singapore', currency: 'SGD', locale: 'en-SG', fiscalYearStartMonth: 1, taxName: 'GST', taxIdLabel: 'GST reg. no.', ...simple('GST', [9, 0]) },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', locale: 'en-ZA', fiscalYearStartMonth: 3, taxName: 'VAT', taxIdLabel: 'VAT number', ...simple('VAT', [15, 0]) },
  { code: 'LK', name: 'Sri Lanka', currency: 'LKR', locale: 'en-LK', fiscalYearStartMonth: 4, taxName: 'VAT', taxIdLabel: 'TIN', ...simple('VAT', [18, 0]) },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', locale: 'en-AE', fiscalYearStartMonth: 1, taxName: 'VAT', taxIdLabel: 'TRN', ...simple('VAT', [5, 0]) },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', locale: 'en-GB', fiscalYearStartMonth: 4, taxName: 'VAT', taxIdLabel: 'VAT number', ...simple('VAT', [20, 5, 0]) },
  {
    code: 'US',
    name: 'United States',
    currency: 'USD',
    locale: 'en-US',
    fiscalYearStartMonth: 1,
    taxName: 'Sales Tax',
    taxIdLabel: 'EIN',
    // Sales tax varies by state and city, so no rates are pre-filled.
    taxAccounts: [payable('2200', 'Sales Tax Payable')],
    taxRates: [],
  },
  { code: 'OTHER', name: 'Other country', currency: 'USD', locale: 'en-US', fiscalYearStartMonth: 1, taxName: 'Tax', taxIdLabel: 'Tax ID', ...simple('Tax', []) },
]

export function getCountry(code: string): CountryPreset {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[COUNTRIES.length - 1]
}

/** Best guess at the user's country from the browser language, e.g. "en-IN" -> India. */
export function detectCountry(): string {
  try {
    const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []
    for (const lang of langs) {
      const region = new Intl.Locale(lang).maximize().region
      if (region && COUNTRIES.some((c) => c.code === region)) return region
    }
  } catch {
    // Fall through to the default.
  }
  return 'US'
}
