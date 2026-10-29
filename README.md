# Ledgerly

Offline-first, double-entry accounting for any business, on any device. Runs in the browser, installs as desktop software (Windows, macOS, Linux) or a phone/tablet app, and keeps working with no internet.

## Run it

```bash
npm install
npm run dev        # development server at http://localhost:5173
npm test           # test suite (accounting engine, documents, banking, reports)
npm run build      # production build in dist/ (includes the offline service worker)
npm run preview    # serve the production build at http://localhost:4173
```

To use it as an app, open the production build in Chrome or Edge and click the install icon in the address bar. On Android choose **Install app** from the browser menu; on iPhone/iPad use **Share → Add to Home Screen**.

## What's inside

The app is organised into sections, each with its own tabs, so no screen is crowded:

| Section | Tabs |
|---|---|
| **Home** | Key figures, income vs expenses, to-do list, money owed to you, bills to pay, cash position, health check |
| **Sales** | Invoices · Quotes · Payments received · Credit notes · Customers |
| **Purchases** | Bills · Expenses · Purchase orders · Payments made · Supplier credits · Suppliers |
| **Banking** | Accounts · Transactions · Statement review (CSV import, matching, rules) · Reconcile · Rules |
| **Items** | Products & services · Stock (average cost, low-stock alerts, adjustments) |
| **Accounting** | Journal · Chart of accounts · Opening balances |
| **Reports** | P&L (with period comparison), balance sheet, cash flow, aged receivables/payables, sales by customer/item, purchases by supplier, tax summary, stock value, trial balance, general ledger |
| **Settings** | Business, invoice look (logo, colour, payment details), preferences, taxes, lock books, backup, activity log |

Highlights:

- **Documents post themselves**: invoices, bills, credits, expenses and payments create balanced journal entries, including cost of goods sold for stock items. Editing replaces the entry; voiding cancels it; history is kept.
- **Taxes per line**, with multi-part rates (e.g. CGST + SGST), tax-inclusive prices, and unclaimable purchase tax added to cost.
- **Printable documents** with your logo and colour; share by WhatsApp or email, or save as PDF.
- **Receipts and files** attached to any document, including photos from a phone camera.
- **Simple and accountant modes**, a command bar (Ctrl/⌘+K), dark mode, 12 industry templates and 18 country tax presets.

## Project layout

```
src/accounting/   Engine, documents, payments, items & stock, banking, reports, templates, demo, backups (+ tests)
src/db/           IndexedDB schema (Dexie) with a change outbox for sync
src/components/   UI kit, layout shell, pickers, attachments, chart
src/pages/        Screens for each section
server/           Sync server (work in progress: accounts, push/pull with accounting rules)
```

## Roadmap

1. **Sync & accounts**: finish wiring the sync server into the app so books stay the same on every device; team access with roles.
2. **Recurring invoices and bills**, payment reminders, and online payment links.
3. **Budgets, fixed assets with depreciation, projects and job costing.**
4. **Multi-currency**, native desktop (Tauri) and store apps (Capacitor), AI receipt reading.
