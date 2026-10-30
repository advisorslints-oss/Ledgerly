import type { Company, Doc, PaymentSettings } from '../db/types'
import { currencyDigits, toInputValue } from '../lib/money'

/** A UPI ID looks like name@bank. */
export const isUpiId = (s: string) => /^[\w.-]{2,256}@[a-zA-Z][\w.-]{1,63}$/.test(s.trim())

/** A payment page link must be a web address (placeholders allowed). */
export const isPayLink = (s: string) => /^https:\/\/[^\s/]+\.[^\s]+$/i.test(s.trim())

/** Plain decimal amount for links and UPI, e.g. 118000 paise -> "1180.00". */
export function plainAmount(minor: number, currency: string): string {
  return toInputValue(minor, currencyDigits(currency)) || '0'
}

/**
 * A UPI payment link (NPCI deep link). Phones open it in any UPI app with the amount and note filled in,
 * and the same text in a QR code can be scanned by those apps.
 */
export function upiLink(upiId: string, payee: string, amount: number, note: string): string {
  const q = (k: string, v: string) => `${k}=${encodeURIComponent(v)}`
  return `upi://pay?${[q('pa', upiId.trim()), q('pn', payee.trim()), q('am', plainAmount(amount, 'INR')), q('cu', 'INR'), q('tn', note)].join('&')}`
}

/** Fills {amount}, {currency} and {number} in a payment page link. */
export function fillPayLink(template: string, v: { amount: number; currency: string; number: string }): string {
  const values: Record<string, string> = { amount: plainAmount(v.amount, v.currency), currency: v.currency, number: v.number }
  return template.trim().replace(/\{(amount|currency|number)\}/g, (_, k: string) => encodeURIComponent(values[k]))
}

export interface PayOptions {
  upi?: { id: string; url: string }
  link?: string
  showQr: boolean
}

export function paymentSettings(company: Pick<Company, 'documentSettings'>): PaymentSettings {
  return company.documentSettings?.payments ?? {}
}

/** The ways a customer can pay this invoice online, or undefined if there are none (or nothing is due). */
export function payOptions(company: Pick<Company, 'name' | 'currency' | 'documentSettings'>, doc: Pick<Doc, 'type' | 'number' | 'status'>, due: number): PayOptions | undefined {
  if (doc.type !== 'invoice' || doc.status === 'void' || due <= 0) return undefined
  const s = paymentSettings(company)
  const upi = company.currency === 'INR' && s.upiId && isUpiId(s.upiId) ? { id: s.upiId.trim(), url: upiLink(s.upiId, s.upiName || company.name, due, `Invoice ${doc.number}`) } : undefined
  const link = s.link && isPayLink(s.link) ? fillPayLink(s.link, { amount: due, currency: company.currency, number: doc.number }) : undefined
  if (!upi && !link) return undefined
  return { upi, link, showQr: s.showQr ?? true }
}

/** "How to pay" text for messages: bank details, then the UPI ID and payment link if set. */
export function howToPay(company: Pick<Company, 'name' | 'currency' | 'documentSettings'>, doc: Pick<Doc, 'type' | 'number' | 'status'>, due: number): string {
  const pay = payOptions(company, doc, due)
  return [company.documentSettings?.bankDetails?.trim(), pay?.upi && `UPI: ${pay.upi.id}`, pay?.link && `Pay online: ${pay.link}`].filter(Boolean).join('\n')
}
