# Ledgerly

Offline-first, double-entry accounting for any business, on any device. Runs in the browser, installs as desktop software (Windows, macOS, Linux) or a phone/tablet app, and keeps working with no internet.

## Run it

The simplest way: build once, then start the server. It serves the website and the sync service together at http://localhost:8787.

```bash
npm install
npm run build      # production build in dist/ (includes the offline service worker)
npm start          # website + sync at http://localhost:8787
```

While developing, run the sync server and the app side by side (the app reaches the server through `/api`):

```bash
npm run server     # sync server at http://localhost:8787, restarts on changes
npm run dev        # app with hot reload at http://localhost:5173
npm test           # tests: accounting engine, documents, banking, reports, server, two-device sync
```

To use it as an app, open it in Chrome or Edge and click the install icon in the address bar. On Android choose **Install app** from the browser menu; on iPhone/iPad use **Share → Add to Home Screen**.

### Sync and accounts

Without an account Ledgerly works entirely on one device. Signing in (**Settings → Account & sync**) keeps businesses identical on every device:

- Changes save on the device first, then sync in the background: right after a save, every 30 seconds, and when the device comes back online. Work done offline syncs later.
- The server keeps the books consistent when devices disagree: entry, invoice and payment numbers created offline are renumbered if they clash, an entry can't be reversed twice, locked periods stay locked, and every entry must balance. A change the server refuses is undone on that device and listed under **Changes that couldn't sync**.
- **Settings → Team** invites people as an editor or a view-only viewer.
- Receipt photos and other attachments sync too.

### Hosting it online

`npm start` runs on any host with Node.js 26 (a VPS, Render, Railway, Fly.io…). Put it behind HTTPS. Options, as environment variables or flags:

| Setting | Default | |
|---|---|---|
| `PORT` / `--port=` | `8787` | Port to listen on |
| `DATA_DIR` / `--data=` | `server/data` | Where the database (`ledgerly.db`) lives. Back this folder up. |
| `STATIC_DIR` | `dist` | The built app to serve |

If the app is hosted somewhere else (or wrapped as a desktop/phone app), enter the server's address under **Advanced** on the sign-in screen. `server/dev-account.example.json` has a throwaway account for trying sync locally.

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
src/sync/         Sync protocol, API client, sync engine and the in-app controller
server/           Sync server: accounts, teams, files, push/pull with accounting rules (Node + built-in SQLite)
tests/            End-to-end tests with two devices syncing through a real server
```

## Roadmap

1. **Recurring invoices and bills**, payment reminders, and online payment links.
2. **Budgets, fixed assets with depreciation, projects and job costing.**
3. **Multi-currency**, password reset by email, native desktop (Tauri) and store apps (Capacitor), AI receipt reading.
