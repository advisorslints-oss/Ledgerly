import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Company } from '../db/types'
import { formatDate } from '../lib/dates'
import { currencyDigits, formatMoney, parseAmount, toInputValue, type FormatOptions } from '../lib/money'

const CompanyContext = createContext<Company | null>(null)

export function CompanyProvider({ company, children }: { company: Company; children: ReactNode }) {
  return <CompanyContext.Provider value={company}>{children}</CompanyContext.Provider>
}

export function useCompany(): Company {
  const company = useContext(CompanyContext)
  if (!company) throw new Error('useCompany must be used inside CompanyProvider')
  return company
}

/** Money and date helpers bound to the current company's currency and locale. */
export function useFormat() {
  const company = useCompany()
  return useMemo(() => {
    const digits = currencyDigits(company.currency)
    return {
      digits,
      currency: company.currency,
      money: (minor: number, opts?: FormatOptions) => formatMoney(minor, company.currency, company.locale, opts),
      parse: (input: string) => parseAmount(input, digits),
      toInput: (minor: number) => toInputValue(minor, digits),
      date: (iso: string, style?: 'short' | 'medium') => formatDate(iso, company.locale, style),
    }
  }, [company.currency, company.locale])
}
