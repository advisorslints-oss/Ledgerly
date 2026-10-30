import { describe, expect, it } from 'vitest'
import { fillPayLink, howToPay, isPayLink, isUpiId, payOptions, upiLink } from './paylinks'

const india = { name: 'Sunrise Traders', currency: 'INR', documentSettings: { bankDetails: 'HDFC 0012345', payments: { upiId: 'sunrise@okhdfc', link: 'https://rzp.io/l/sunrise?amount={amount}&ref={number}' } } }
const invoice = { type: 'invoice' as const, number: 'INV-0007', status: 'posted' as const }

describe('payment links', () => {
  it('builds a UPI link with the amount and invoice number', () => {
    expect(upiLink('sunrise@okhdfc', 'Sunrise & Sons', 118_050, 'Invoice INV-0007')).toBe('upi://pay?pa=sunrise%40okhdfc&pn=Sunrise%20%26%20Sons&am=1180.50&cu=INR&tn=Invoice%20INV-0007')
    expect(isUpiId('shop.name-1@okicici')).toBe(true)
    expect(isUpiId('not an id')).toBe(false)
  })

  it('fills a payment page link', () => {
    expect(fillPayLink('https://paypal.me/brightside/{amount}{currency}', { amount: 2_500, currency: 'USD', number: 'INV-1' })).toBe('https://paypal.me/brightside/25.00USD')
    expect(fillPayLink('https://pay.example/x?ref={number}', { amount: 1, currency: 'JPY', number: 'INV 2/3' })).toBe('https://pay.example/x?ref=INV%202%2F3')
    expect(isPayLink('https://buy.stripe.com/abc')).toBe(true)
    expect(isPayLink('http://insecure.example')).toBe(false)
    expect(isPayLink('javascript:alert(1)')).toBe(false)
  })

  it('offers what is set up, only while money is due', () => {
    const pay = payOptions(india, invoice, 50_000)!
    expect(pay.upi?.url).toContain('am=500.00')
    expect(pay.link).toBe('https://rzp.io/l/sunrise?amount=500.00&ref=INV-0007')
    expect(pay.showQr).toBe(true)
    expect(payOptions(india, invoice, 0)).toBeUndefined()
    expect(payOptions(india, { ...invoice, type: 'quote' }, 50_000)).toBeUndefined()
    // UPI is only for rupees.
    expect(payOptions({ ...india, currency: 'USD' }, invoice, 50_000)?.upi).toBeUndefined()
    expect(payOptions({ name: 'X', currency: 'USD', documentSettings: {} }, invoice, 50_000)).toBeUndefined()
  })

  it('writes how to pay for messages', () => {
    expect(howToPay(india, invoice, 50_000)).toBe('HDFC 0012345\nUPI: sunrise@okhdfc\nPay online: https://rzp.io/l/sunrise?amount=500.00&ref=INV-0007')
    expect(howToPay(india, invoice, 0)).toBe('HDFC 0012345')
  })
})
