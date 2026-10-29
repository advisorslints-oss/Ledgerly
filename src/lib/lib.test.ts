import { describe, expect, it } from 'vitest'
import { addMonths, fiscalYearEnd, fiscalYearStart, isISODate, presetRange } from './dates'
import { currencyDigits, formatMoney, parseAmount, toInputValue } from './money'

describe('money', () => {
  it('parses amounts into exact minor units', () => {
    expect(parseAmount('1,234.56', 2)).toBe(123456)
    expect(parseAmount('1.005', 2)).toBe(101)
    expect(parseAmount('0.1', 2)).toBe(10)
    expect(parseAmount('(50)', 2)).toBe(-5000)
    expect(parseAmount('-7.5', 2)).toBe(-750)
    expect(parseAmount('₹ 12,34,567.8', 2)).toBe(123456780)
    expect(parseAmount('1500', 0)).toBe(1500)
    expect(parseAmount('12.3456', 3)).toBe(12346)
    expect(parseAmount('abc', 2)).toBeNull()
    expect(parseAmount('', 2)).toBeNull()
    expect(parseAmount('1.2.3', 2)).toBeNull()
  })

  it('round-trips input values', () => {
    expect(toInputValue(123456, 2)).toBe('1234.56')
    expect(toInputValue(5, 2)).toBe('0.05')
    expect(toInputValue(-750, 2)).toBe('-7.50')
    expect(toInputValue(1500, 0)).toBe('1500')
    expect(toInputValue(0, 2)).toBe('')
  })

  it('knows currency decimals and formats by locale', () => {
    expect(currencyDigits('USD')).toBe(2)
    expect(currencyDigits('JPY')).toBe(0)
    expect(currencyDigits('KWD')).toBe(3)
    expect(formatMoney(123456789, 'INR', 'en-IN')).toBe('₹12,34,567.89')
    expect(formatMoney(-5000, 'USD', 'en-US')).toBe('-$50.00')
  })
})

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isISODate('2026-02-28')).toBe(true)
    expect(isISODate('2026-02-30')).toBe(false)
    expect(isISODate('26-2-3')).toBe(false)
  })

  it('handles month arithmetic at month ends', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15')
  })

  it('computes fiscal years', () => {
    expect(fiscalYearStart('2026-03-31', 4)).toBe('2025-04-01')
    expect(fiscalYearStart('2026-04-01', 4)).toBe('2026-04-01')
    expect(fiscalYearEnd('2026-10-29', 4)).toBe('2027-03-31')
    expect(fiscalYearStart('2026-10-29', 1)).toBe('2026-01-01')
    expect(fiscalYearEnd('2026-10-29', 7)).toBe('2027-06-30')
  })

  it('builds fiscal quarters', () => {
    expect(presetRange('this_quarter', 4, '2026-10-29')).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(presetRange('last_quarter', 4, '2026-10-29')).toEqual({ from: '2026-07-01', to: '2026-09-30' })
    expect(presetRange('this_quarter', 1, '2026-02-10')).toEqual({ from: '2026-01-01', to: '2026-03-31' })
    expect(presetRange('last_fy', 4, '2026-10-29')).toEqual({ from: '2025-04-01', to: '2026-03-31' })
    expect(presetRange('last_month', 1, '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })
})
