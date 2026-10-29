import type { LedgerDB } from '../db/database'
import type { Company, DocLine } from '../db/types'
import { addDays, addMonths, startOfMonth, today } from '../lib/dates'
import { newId } from '../lib/id'
import { currencyDigits, fromMajor } from '../lib/money'
import { importStatement } from './banking'
import { createCompany } from './company'
import { saveContact } from './contacts'
import { getCountry } from './countries'
import { saveDocument, setDocumentStatus } from './documents'
import { postEntry } from './engine'
import { saveItem } from './items'
import { savePayment } from './payments'

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
  const cid = company.id

  const accounts = await db.accounts.where('companyId').equals(cid).toArray()
  const id = (code: string) => accounts.find((a) => a.code === code)!.id
  // The standard rate: the highest one at or under 25%, so luxury slabs (like India's 40%) are skipped.
  const taxRates = (await db.taxRates.where('companyId').equals(cid).toArray()).filter((t) => t.rate > 0 && t.rate <= 25).sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name))
  const salesTax = taxRates.find((t) => t.components.every((c) => c.salesAccountId))?.id
  const purchaseTax = taxRates.find((t) => t.components.every((c) => c.purchaseAccountId))?.id
  const digits = currencyDigits(company.currency)
  const scale = SCALE[company.currency] ?? 1
  const random = rng(42)
  // Amounts are rounded to a tidy step so they read like real figures.
  const step = Math.max(1, Math.round(scale))
  const money = (base: number) => fromMajor(Math.round((base * scale) / step) * step, digits)
  const vary = (min: number, max: number) => money(min + random() * (max - min))

  const end = today()
  const first = addMonths(startOfMonth(end), -6)
  const day = (month: string, d: number) => month.slice(0, 8) + String(d).padStart(2, '0')
  const post = async (date: string, memo: string, debits: [string, number][], credits: [string, number][]) => {
    if (date > end) return
    await postEntry(db, {
      companyId: cid,
      date,
      memo,
      lines: [...debits.map(([code, amount]) => ({ accountId: id(code), debit: amount })), ...credits.map(([code, amount]) => ({ accountId: id(code), credit: amount }))],
    })
  }
  const line = (description: string, quantity: number, rate: number, accountCode: string, extra: Partial<DocLine> = {}): DocLine => ({
    id: newId(),
    description,
    quantity,
    rate,
    accountId: id(accountCode),
    ...extra,
  })

  await db.write(async () => {
    const contact = (name: string, type: 'customer' | 'supplier', paymentTermsDays: number, email: string) =>
      saveContact(db, cid, { name, type, paymentTermsDays, email })
    const northwind = await contact('Northwind Ltd', 'customer', 15, 'accounts@northwind.example')
    const lakeside = await contact('Lakeside Hotel', 'customer', 30, 'purchasing@lakeside.example')
    const cityEvents = await contact('City Events Co', 'customer', 7, 'hello@cityevents.example')
    const greenfield = await contact('Greenfield Farms', 'supplier', 10, 'orders@greenfield.example')
    const beanCo = await contact('Bean & Co Roasters', 'supplier', 30, 'sales@beanco.example')
    const metro = await contact('Metro Power', 'supplier', 0, 'billing@metropower.example')
    const packRight = await contact('PackRight Supplies', 'supplier', 15, 'sales@packright.example')

    const platter = await saveItem(db, cid, {
      kind: 'service', name: 'Catering platter (per guest)', unit: 'guest', salePrice: money(18), purchasePrice: 0,
      salesAccountId: id('4020'), salesTaxRateId: salesTax, trackStock: false,
    })
    const beans = await saveItem(db, cid, {
      kind: 'product', name: 'House blend coffee beans 1kg', sku: 'BEAN-1KG', unit: 'bag', salePrice: money(28), purchasePrice: money(16),
      salesAccountId: id('4010'), salesTaxRateId: salesTax, purchaseTaxRateId: purchaseTax, trackStock: true, reorderLevel: 20,
    })
    await saveItem(db, cid, {
      kind: 'product', name: 'Takeaway cups (box of 500)', sku: 'CUP-500', unit: 'box', salePrice: 0, purchasePrice: money(42),
      purchaseAccountId: id('5020'), purchaseTaxRateId: purchaseTax, trackStock: false,
    })

    await post(day(first, 1), 'Owner investment', [['1010', money(40000)]], [['3000', money(40000)]])
    await post(day(first, 2), 'Business loan received', [['1010', money(25000)]], [['2500', money(25000)]])
    await post(day(first, 3), 'Espresso machine and ovens', [['1520', money(22000)]], [['1010', money(22000)]])
    await post(day(first, 4), 'Tables and chairs', [['1500', money(8000)]], [['1010', money(8000)]])

    const invoice = async (date: string, contactId: string, lines: DocLine[], terms: number) =>
      date > end ? null : saveDocument(db, cid, { type: 'invoice', contactId, date, dueDate: addDays(date, terms), lines, taxInclusive: false }, { post: true })
    const bill = async (date: string, contactId: string, lines: DocLine[], terms: number, reference: string) =>
      date > end ? null : saveDocument(db, cid, { type: 'bill', contactId, date, dueDate: addDays(date, terms), reference, lines, taxInclusive: false }, { post: true })
    const pay = async (direction: 'in' | 'out', date: string, contactId: string, docId: string, amount: number) => {
      if (date > end) return
      await savePayment(db, cid, { direction, contactId, date, amount, accountId: id('1010'), allocations: [{ documentId: docId, amount }] })
    }

    for (let m = 0; m <= 6; m++) {
      const month = addMonths(first, m)
      const growth = 1 + m * 0.06
      const latest = m >= 5
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
        const produce = bill(day(month, d), greenfield.id, [line('Fresh produce and dairy', 1, vary(3800, 5200), '5000')], 10, `GF-${m}${d}`)
        const doc = await produce
        if (doc && !(latest && d === 16)) await pay('out', day(month, d + 9), greenfield.id, doc.id, doc.total)
      }
      const beanBill = await bill(day(month, 3), beanCo.id, [line(beans.name, 40, beans.purchasePrice, '1200', { itemId: beans.id, taxRateId: purchaseTax })], 30, `BC-${1000 + m}`)
      if (beanBill && !latest) await pay('out', day(month, 27), beanCo.id, beanBill.id, beanBill.total)

      const hotel = await invoice(day(month, 8), lakeside.id, [line(beans.name, 25, beans.salePrice, '4010', { itemId: beans.id, taxRateId: salesTax })], 30)
      if (hotel && m < 5) await pay('in', day(addMonths(month, 1), 6), lakeside.id, hotel.id, hotel.total)
      const guests = 40 + Math.round(random() * 40)
      const catering = await invoice(day(month, 12), northwind.id, [line(platter.name, guests, platter.salePrice, '4020', { itemId: platter.id, taxRateId: salesTax })], 15)
      if (catering && m < 5) await pay('in', day(addMonths(month, 1), 5), northwind.id, catering.id, catering.total)
      if (catering && m === 5) await pay('in', day(addMonths(month, 1), 2), northwind.id, catering.id, Math.round(catering.total / 2))

      const power = vary(600, 900)
      if (day(month, 20) <= end) {
        await saveDocument(db, cid, { type: 'expense', contactId: metro.id, date: day(month, 20), reference: `MP-${m}`, lines: [line('Electricity and water', 1, power, '6010')], taxInclusive: false, paidFromAccountId: id('1010') }, { post: true })
      }
      if (day(month, 6) <= end) {
        await saveDocument(db, cid, { type: 'expense', date: day(month, 6), lines: [line('Internet and phone', 1, money(120), '6050')], taxInclusive: false, paidFromAccountId: id('1010') }, { post: true })
      }

      const packaging = vary(180, 320)
      await post(day(month, 11), 'Takeaway cups and boxes', [['5020', packaging]], [['1000', packaging]])
      await post(day(month, 10), 'Loan repayment', [['2500', money(600)], ['7000', money(180)]], [['1010', money(780)]])
      const kitchen = vary(150, 350)
      await post(day(month, 18), 'Cleaning and kitchen supplies', [['6210', kitchen]], [['1000', kitchen]])
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

    const quote = await saveDocument(db, cid, {
      type: 'quote', contactId: cityEvents.id, date: addDays(end, -3), dueDate: addDays(end, 11), taxInclusive: false,
      lines: [line(platter.name, 120, platter.salePrice, '4020', { itemId: platter.id, taxRateId: salesTax }), line('Barista service (4 hours)', 4, money(35), '4020', { taxRateId: salesTax })],
      notes: 'Thank you for considering Brightside for your event.',
    })
    await setDocumentStatus(db, quote.id, 'sent')
    const order = await saveDocument(db, cid, {
      type: 'purchase_order', contactId: packRight.id, date: addDays(end, -2), dueDate: addDays(end, 5), taxInclusive: false,
      lines: [line('Takeaway cups (box of 500)', 6, money(42), '5020', { taxRateId: purchaseTax })],
    })
    await setDocumentStatus(db, order.id, 'issued')
  })

  // A recent bank statement with a few lines to review, including two that match recorded payments.
  const bankLines = await db.journalLines.where('[accountId+date]').between([id('1010'), addDays(end, -10)], [id('1010'), end]).toArray()
  const recentEntries = new Map((await db.journalEntries.bulkGet([...new Set(bankLines.map((l) => l.entryId))])).filter((e) => !!e).map((e) => [e!.id, e!]))
  const known = bankLines.slice(-2).map((l) => ({ date: l.date, description: (recentEntries.get(l.entryId)?.memo ?? 'Payment').toUpperCase(), amount: l.debit - l.credit }))
  await importStatement(db, cid, id('1010'), [
    ...known,
    { date: addDays(end, -4), description: 'CARD PURCHASE - OFFICEWORKS', amount: -money(86) },
    { date: addDays(end, -3), description: 'DIRECT DEBIT - CITYWATER UTILITIES', amount: -money(140) },
    { date: addDays(end, -1), description: 'TRANSFER IN - CATERING DEPOSIT CITY EVENTS', amount: money(500) },
  ])

  return company
}
