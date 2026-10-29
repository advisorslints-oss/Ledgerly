import type { LedgerDB } from '../db/database'
import type { Company } from '../db/types'
import { addMonths, startOfMonth, today } from '../lib/dates'
import { currencyDigits, fromMajor } from '../lib/money'
import { createCompany } from './company'
import { getCountry } from './countries'
import { postEntry } from './engine'

// Rough local-price multipliers so demo figures look believable in each currency.
const SCALE: Record<string, number> = {
  INR: 40, PKR: 120, BDT: 50, LKR: 120, NPR: 60, KES: 60, NGN: 700, PHP: 25, IDR: 7000, VND: 10000,
  JPY: 100, CNY: 4, HKD: 6, THB: 20, MYR: 3, ZAR: 9, EGP: 20, TRY: 15, MXN: 9, BRL: 3,
  AED: 3, SAR: 3, QAR: 3, KWD: 0.25, BHD: 0.3, OMR: 0.3,
}

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Creates a café with about six months of realistic history, so every screen has something to show. */
export async function createDemoCompany(db: LedgerDB, countryCode: string): Promise<Company> {
  const country = getCountry(countryCode)
  const company = await createCompany(db, {
    name: 'Brightside Café (Demo)',
    country: country.code,
    currency: country.currency,
    industry: 'restaurant',
    fiscalYearStartMonth: country.fiscalYearStartMonth,
    features: { inventory: true, projects: false },
    isDemo: true,
  })

  const accounts = await db.accounts.where('companyId').equals(company.id).toArray()
  const id = (code: string) => accounts.find((a) => a.code === code)!.id
  const digits = currencyDigits(company.currency)
  const scale = SCALE[company.currency] ?? 1
  const random = rng(42)
  // Amounts are rounded to a tidy step so they read like real figures.
  const step = Math.max(1, Math.round(scale))
  const money = (base: number) => fromMajor(Math.round((base * scale) / step) * step, digits)
  const vary = (min: number, max: number) => money(min + random() * (max - min))

  const end = today()
  const first = addMonths(startOfMonth(end), -6)
  const post = async (date: string, memo: string, debits: [string, number][], credits: [string, number][]) => {
    if (date > end) return
    await postEntry(db, {
      companyId: company.id,
      date,
      memo,
      lines: [
        ...debits.map(([code, amount]) => ({ accountId: id(code), debit: amount })),
        ...credits.map(([code, amount]) => ({ accountId: id(code), credit: amount })),
      ],
    })
  }
  const day = (month: string, d: number) => month.slice(0, 8) + String(d).padStart(2, '0')

  await db.write(async () => {
    await post(day(first, 1), 'Owner investment', [['1010', money(40000)]], [['3000', money(40000)]])
    await post(day(first, 2), 'Business loan received', [['1010', money(25000)]], [['2500', money(25000)]])
    await post(day(first, 3), 'Espresso machine and ovens', [['1520', money(22000)]], [['1010', money(22000)]])
    await post(day(first, 4), 'Tables and chairs', [['1500', money(8000)]], [['1010', money(8000)]])

    for (let m = 0; m <= 6; m++) {
      const month = addMonths(first, m)
      const growth = 1 + m * 0.06
      let cashTaken = 0

      await post(day(month, 1), 'Monthly rent', [['6000', money(5000)]], [['1010', money(5000)]])
      for (const d of [7, 14, 21, 28]) {
        const food = Math.round(vary(4200, 6200) * growth)
        const cash = Math.round(food * 0.3)
        cashTaken += cash
        await post(day(month, d), 'Weekly food sales', [['1000', cash], ['1010', food - cash]], [['4000', food]])
        const drinks = Math.round(vary(1100, 1900) * growth)
        await post(day(month, d), 'Weekly beverage sales', [['1010', drinks]], [['4010', drinks]])
      }
      for (const d of [2, 16]) {
        const supplies = vary(3800, 5200)
        await post(day(month, d), 'Produce and dairy from Greenfield Farms', [['5000', supplies]], [['2000', supplies]])
        await post(day(month, d + 10), 'Paid Greenfield Farms', [['2000', supplies]], [['1010', supplies]])
      }
      const catering = vary(1500, 3200)
      await post(day(month, 12), 'Catering for Northwind Ltd office party', [['1100', catering]], [['4020', catering]])
      await post(day(addMonths(month, 1), 5), 'Northwind Ltd paid catering invoice', [['1010', catering]], [['1100', catering]])

      const beverages = vary(650, 950)
      await post(day(month, 9), 'Coffee beans and syrups', [['5010', beverages]], [['1010', beverages]])
      const packaging = vary(180, 320)
      await post(day(month, 11), 'Takeaway cups and boxes', [['5020', packaging]], [['1000', packaging]])
      await post(day(month, 6), 'Internet and phone', [['6050', money(120)]], [['1010', money(120)]])
      await post(day(month, 10), 'Loan repayment', [['2500', money(600)], ['7000', money(180)]], [['1010', money(780)]])
      const kitchen = vary(150, 350)
      await post(day(month, 18), 'Cleaning and kitchen supplies', [['6210', kitchen]], [['1000', kitchen]])
      const power = vary(600, 900)
      await post(day(month, 20), 'Electricity and water', [['6010', power]], [['1010', power]])
      const delivery = Math.round(vary(450, 800) * growth)
      await post(day(month, 25), 'Delivery app commissions', [['6200', delivery]], [['1010', delivery]])
      if (m % 2 === 1) {
        const ads = vary(400, 1100)
        await post(day(month, 15), 'Social media ads', [['6060', ads]], [['2100', ads]])
        await post(day(month, 27), 'Credit card payment', [['2100', ads]], [['1010', ads]])
      }
      const deposit = Math.round((cashTaken * 0.8) / 10 ** digits) * 10 ** digits
      await post(day(month, 27), 'Cash deposited to bank', [['1010', deposit]], [['1000', deposit]])
      await post(day(month, 28), 'Staff salaries', [['6020', money(12500)]], [['1010', money(12500)]])
      const fees = vary(25, 60)
      await post(day(month, 28), 'Bank charges', [['6110', fees]], [['1010', fees]])
      await post(day(month, 28), 'Owner drawings', [['3100', money(1000)]], [['1010', money(1000)]])
      await post(day(month, 28), 'Monthly depreciation', [['6130', money(300)]], [['1590', money(300)]])
    }
  })

  return company
}
