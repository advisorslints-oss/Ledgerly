// All amounts are stored as integers in the currency's minor unit (cents, paise, fils…)
// so that sums are exact. Floats only appear when formatting for display.

const digitsCache = new Map<string, number>()

export function currencyDigits(currency: string): number {
  let digits = digitsCache.get(currency)
  if (digits === undefined) {
    try {
      digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
    } catch {
      digits = 2
    }
    digitsCache.set(currency, digits)
  }
  return digits
}

/** Parses user input like "1,234.50" or "(99)" into minor units. Returns null if not a number. */
export function parseAmount(input: string, digits: number): number | null {
  let s = input.trim()
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  s = s.replace(/[\s,'_]/g, '').replace(/^[^\d.-]+/, '')
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null

  const [whole = '0', frac = ''] = s.split('.')
  const padded = (frac + '0'.repeat(digits + 1)).slice(0, digits + 1)
  let minor = Number(whole || '0') * 10 ** digits + Number(padded.slice(0, digits) || '0')
  if (Number(padded.slice(digits)) >= 5) minor += 1
  if (!Number.isSafeInteger(minor)) return null
  return negative ? -minor : minor
}

/** Formats minor units as a plain number string for inputs, e.g. 123450 -> "1234.50". */
export function toInputValue(minor: number, digits: number): string {
  if (!minor) return ''
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  if (digits === 0) return sign + String(abs)
  const s = String(abs).padStart(digits + 1, '0')
  return `${sign}${s.slice(0, -digits)}.${s.slice(-digits)}`
}

const formatterCache = new Map<string, Intl.NumberFormat>()

function formatter(locale: string, currency: string, compact: boolean, symbol: boolean): Intl.NumberFormat {
  const key = `${locale}|${currency}|${compact}|${symbol}`
  let f = formatterCache.get(key)
  if (!f) {
    const digits = currencyDigits(currency)
    f = new Intl.NumberFormat(
      locale,
      compact
        ? { style: symbol ? 'currency' : 'decimal', currency: symbol ? currency : undefined, notation: 'compact', maximumSignificantDigits: 3 }
        : { style: symbol ? 'currency' : 'decimal', currency: symbol ? currency : undefined, minimumFractionDigits: digits, maximumFractionDigits: digits },
    )
    formatterCache.set(key, f)
  }
  return f
}

export interface FormatOptions {
  compact?: boolean
  symbol?: boolean
}

export function formatMoney(minor: number, currency: string, locale: string, opts: FormatOptions = {}): string {
  const digits = currencyDigits(currency)
  return formatter(locale, currency, opts.compact ?? false, opts.symbol ?? true).format(minor / 10 ** digits)
}

/** Converts a major-unit amount (e.g. 1250.5) into minor units, rounding half away from zero. */
export function fromMajor(major: number, digits: number): number {
  const scaled = major * 10 ** digits
  return Math.sign(scaled) * Math.round(Math.abs(scaled))
}

export const CURRENCIES: { code: string; name: string }[] = [
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'BDT', name: 'Bangladeshi Taka' },
  { code: 'BHD', name: 'Bahraini Dinar' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'EGP', name: 'Egyptian Pound' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'IDR', name: 'Indonesian Rupiah' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'KES', name: 'Kenyan Shilling' },
  { code: 'KWD', name: 'Kuwaiti Dinar' },
  { code: 'LKR', name: 'Sri Lankan Rupee' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'MYR', name: 'Malaysian Ringgit' },
  { code: 'NGN', name: 'Nigerian Naira' },
  { code: 'NPR', name: 'Nepalese Rupee' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'OMR', name: 'Omani Rial' },
  { code: 'PHP', name: 'Philippine Peso' },
  { code: 'PKR', name: 'Pakistani Rupee' },
  { code: 'QAR', name: 'Qatari Riyal' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'THB', name: 'Thai Baht' },
  { code: 'TRY', name: 'Turkish Lira' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'VND', name: 'Vietnamese Dong' },
  { code: 'ZAR', name: 'South African Rand' },
]
