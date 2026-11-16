# Ledgerly

### 🌐 **Live Web App (Use on Any Device):** [https://advisorslints-oss.github.io/Ledgerly/](https://advisorslints-oss.github.io/Ledgerly/)

Offline-first, double-entry accounting for any business, on any device. Runs directly in any modern browser, installs as an app on your phone, tablet, or desktop, and keeps working with no internet connection.


## Run it

**Without a server:** `npm run build:offline` makes `offline/Ledgerly.html`, the whole app in one file. Double-click it to open it in your browser; your books are saved in that browser. Copy the file to a USB stick or another computer and it works there too (each browser keeps its own books until you sign in to sync, which needs a server address under **Advanced**).

The simplest way to run it as a website: build once, then start the server. It serves the website and the sync service together at http://localhost:8787.

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
| **Sales** | Invoices · Quotes · Payments received · Reminders · Recurring · Credit notes · Customers |
| **Purchases** | Bills · Expenses · Purchase orders · Payments made · Recurring · Supplier credits · Suppliers |
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
- **Recurring invoices, bills and expenses**: weekly, monthly, quarterly or yearly, ending never, on a date or after a number of times, approved automatically or saved as drafts. Dates missed while the app was closed are caught up; each occurrence has a fixed id, so two devices can't create it twice. For a synced business, a device only creates them right after it has caught up with the server.
- **Online payment links**: add your UPI ID (India) and/or a payment page link from Stripe, Razorpay, PayPal and the like, with `{amount}`, `{currency}` and `{number}` filled in per invoice. Invoices show a scannable QR code and a pay button, and shared messages and reminders include the link. Money goes straight to you.
- **Payment reminders**: unpaid invoices show up under Sales → Reminders at the stages you choose (before due, on the day, a week late…), with a friendly, firm or final message to send from your own WhatsApp or email. Each one sent is logged on the invoice.
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

1. **Payments marked as paid automatically** (Stripe/Razorpay webhooks through the sync server), and sending reminders by email from the server.
2. **Budgets, fixed assets with depreciation, projects and job costing.**
3. **Multi-currency**, password reset by email, native desktop (Tauri) and store apps (Capacitor), AI receipt reading.
