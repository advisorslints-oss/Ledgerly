# Ledgerly

Offline-first, double-entry accounting for any business, on any device. Runs in the browser, installs as desktop software (Windows, macOS, Linux) or a phone/tablet app, and keeps working with no internet.

## Run it

```bash
npm install
npm run dev        # development server at http://localhost:5173
npm test           # accounting engine test suite
npm run build      # production build in dist/ (includes the offline service worker)
npm run preview    # serve the production build at http://localhost:4173
```

To use it as an app, open the production build in Chrome or Edge and click the install icon in the address bar. On Android choose **Install app** from the browser menu; on iPhone/iPad use **Share → Add to Home Screen**. Any static host (Netlify, Vercel, Cloudflare Pages, S3) can serve `dist/` as the website.

## What's in Phase 1

- **Double-entry engine**: every entry must balance; amounts are stored as integers in the currency's minor unit, so totals are exact. Posted entries are never edited: they are reversed, keeping a full history. Period lock dates, opening balances, and an activity log of every change.
- **Setup wizard**: 12 industry templates (retail, restaurants, construction, healthcare, non-profits…) and 18 country presets with tax rates and accounts (GST with CGST/SGST/IGST for India, VAT, GST/HST, sales tax…).
- **Simple and accountant modes**: "money in / money out" for owners; codes, journal and trial balance for accountants.
- **Reports**: profit & loss, balance sheet, trial balance and account ledgers, with period presets, drill-down, CSV export and print/PDF.
- **Everywhere**: responsive layout with a phone tab bar, command bar (Ctrl/⌘+K), dark mode, offline service worker, backup/restore files, and a demo company.

## Project layout

```
src/accounting/   Engine, reports, templates, country presets, demo data, backups (+ tests)
src/db/           IndexedDB schema (Dexie) with a change outbox for future sync
src/components/   UI kit, layout shell, account picker, quick entry, chart
src/pages/        Screens: onboarding, dashboard, accounts, journal, reports, settings
```

## Roadmap

1. **Sync & accounts**: sign in, sync between devices through a server, multi-user roles.
2. **Sales & purchases**: customers, suppliers, quotes, invoices (PDF/WhatsApp/email), bills, payments, credit notes.
3. **Banking**: statement import, reconciliation, auto-categorisation rules.
4. **More reports**: cash flow, aged receivables/payables, tax returns, budgets.
5. **Inventory, projects, multi-currency, fixed assets**; native desktop (Tauri) and store apps (Capacitor); AI receipt scanning and assistant.
