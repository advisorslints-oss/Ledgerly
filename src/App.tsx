import { useLiveQuery } from 'dexie-react-hooks'
import { Fragment } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router'
import { DOC_TYPES } from './accounting/documents'
import { AppShell } from './components/layout/AppShell'
import { QuickEntryProvider } from './components/QuickEntry'
import { Spinner } from './components/ui/misc'
import { ToastProvider } from './components/ui/toast'
import { db } from './db'
import type { Company, DocType } from './db/types'
import { AccountDetail } from './pages/AccountDetail'
import { Accounts } from './pages/Accounts'
import { BankAccounts, BankReconcile, BankReview, BankRules, BankTransactions } from './pages/Banking'
import { NotFound } from './pages/ComingSoon'
import { Dashboard } from './pages/Dashboard'
import { ContactList, ContactView } from './pages/docs/Contacts'
import { DocumentForm } from './pages/docs/DocumentForm'
import { DocumentList } from './pages/docs/DocumentList'
import { DocumentView } from './pages/docs/DocumentView'
import { PaymentForm, PaymentList, PaymentView } from './pages/docs/Payments'
import { RecurringForm, RecurringList, RecurringView } from './pages/docs/Recurring'
import { Reminders } from './pages/docs/Reminders'
import { ItemsList, ItemView, StockPage } from './pages/Items'
import { Journal } from './pages/Journal'
import { JournalEntryForm } from './pages/JournalEntryForm'
import { JournalEntryView } from './pages/JournalEntryView'
import { Onboarding } from './pages/Onboarding'
import { OpeningBalances } from './pages/OpeningBalances'
import { BalanceSheetReport } from './pages/reports/BalanceSheet'
import { AgedReport, ByContactReport, ByItemReport, CashFlowReport, GeneralLedgerReport, StockSummaryReport, TaxSummaryReport } from './pages/reports/More'
import { ProfitLossReport } from './pages/reports/ProfitLoss'
import { ReportsHome } from './pages/reports/ReportsHome'
import { TrialBalanceReport } from './pages/reports/TrialBalance'
import { AccountingLayout, BankingLayout, ItemsLayout, PurchasesLayout, SalesLayout } from './pages/sections'
import { Settings } from './pages/Settings'
import { SignIn } from './pages/SignIn'
import { CompanyProvider } from './state/company'
import { usePrefs } from './state/prefs'

const SALES: DocType[] = ['invoice', 'quote', 'credit_note']
const PURCHASES: DocType[] = ['bill', 'expense', 'purchase_order', 'supplier_credit']
/** "/sales/invoices" -> "invoices" */
const tail = (type: DocType) => DOC_TYPES[type].path.split('/')[2]

/** Form and detail pages for a document type sit outside the tabbed layout, so they get the whole screen. */
const docPages = (type: DocType) => [
  <Route key={`${type}-new`} path={`${DOC_TYPES[type].path}/new`} element={<DocumentForm key={`new-${type}`} type={type} />} />,
  <Route key={`${type}-edit`} path={`${DOC_TYPES[type].path}/:id/edit`} element={<DocumentForm type={type} />} />,
  <Route key={`${type}-view`} path={`${DOC_TYPES[type].path}/:id`} element={<DocumentView type={type} />} />,
]

export function App() {
  const companies = useLiveQuery(() => db.companies.toArray(), [])

  return (
    <BrowserRouter>
      <ToastProvider>
        {companies === undefined ? (
          <div className="grid min-h-dvh place-items-center">
            <Spinner className="size-6" />
          </div>
        ) : (
          <Routes>
            <Route path="/welcome" element={<Onboarding companies={companies} />} />
            <Route path="/sign-in" element={<SignIn />} />
            <Route element={<Shell companies={companies} />}>
              <Route index element={<Dashboard />} />

              <Route path="sales" element={<SalesLayout />}>
                <Route index element={<Navigate to="invoices" replace />} />
                {SALES.map((t) => (
                  <Route key={t} path={tail(t)} element={<DocumentList key={t} type={t} />} />
                ))}
                <Route path="payments" element={<PaymentList direction="in" />} />
                <Route path="customers" element={<ContactList key="c" kind="customer" />} />
                <Route path="recurring" element={<RecurringList key="s" side="sales" />} />
                <Route path="reminders" element={<Reminders />} />
              </Route>
              {SALES.flatMap(docPages)}
              <Route path="sales/recurring/new" element={<RecurringForm key="s-new" side="sales" />} />
              <Route path="sales/recurring/:id/edit" element={<RecurringForm side="sales" />} />
              <Route path="sales/recurring/:id" element={<RecurringView side="sales" />} />
              <Route path="sales/payments/new" element={<PaymentForm key="in-new" direction="in" />} />
              <Route path="sales/payments/:id/edit" element={<PaymentForm direction="in" />} />
              <Route path="sales/payments/:id" element={<PaymentView direction="in" />} />
              <Route path="sales/customers/:id" element={<ContactView kind="customer" />} />

              <Route path="purchases" element={<PurchasesLayout />}>
                <Route index element={<Navigate to="bills" replace />} />
                {PURCHASES.map((t) => (
                  <Route key={t} path={tail(t)} element={<DocumentList key={t} type={t} />} />
                ))}
                <Route path="payments" element={<PaymentList direction="out" />} />
                <Route path="suppliers" element={<ContactList key="s" kind="supplier" />} />
                <Route path="recurring" element={<RecurringList key="p" side="purchases" />} />
              </Route>
              {PURCHASES.flatMap(docPages)}
              <Route path="purchases/recurring/new" element={<RecurringForm key="p-new" side="purchases" />} />
              <Route path="purchases/recurring/:id/edit" element={<RecurringForm side="purchases" />} />
              <Route path="purchases/recurring/:id" element={<RecurringView side="purchases" />} />
              <Route path="purchases/payments/new" element={<PaymentForm key="out-new" direction="out" />} />
              <Route path="purchases/payments/:id/edit" element={<PaymentForm direction="out" />} />
              <Route path="purchases/payments/:id" element={<PaymentView direction="out" />} />
              <Route path="purchases/suppliers/:id" element={<ContactView kind="supplier" />} />

              <Route path="banking" element={<BankingLayout />}>
                <Route index element={<Navigate to="accounts" replace />} />
                <Route path="accounts" element={<BankAccounts />} />
                <Route path="transactions" element={<BankTransactions />} />
                <Route path="review" element={<BankReview />} />
                <Route path="reconcile" element={<BankReconcile />} />
                <Route path="rules" element={<BankRules />} />
              </Route>

              <Route path="items" element={<ItemsLayout />}>
                <Route index element={<ItemsList />} />
                <Route path="stock" element={<StockPage />} />
              </Route>
              <Route path="items/:id" element={<ItemView />} />

              <Route element={<AccountingLayout />}>
                <Route path="journal" element={<Journal />} />
                <Route path="accounts" element={<Accounts />} />
                <Route path="accounts/opening-balances" element={<OpeningBalances />} />
              </Route>
              <Route path="accounts/:id" element={<AccountDetail />} />
              <Route path="journal/new" element={<JournalEntryForm />} />
              <Route path="journal/:id" element={<JournalEntryView />} />

              <Route path="reports" element={<ReportsHome />} />
              <Route path="reports/profit-and-loss" element={<ProfitLossReport />} />
              <Route path="reports/balance-sheet" element={<BalanceSheetReport />} />
              <Route path="reports/cash-flow" element={<CashFlowReport />} />
              <Route path="reports/trial-balance" element={<TrialBalanceReport />} />
              <Route path="reports/general-ledger" element={<GeneralLedgerReport />} />
              <Route path="reports/aged-receivables" element={<AgedReport key="ar" type="invoice" />} />
              <Route path="reports/aged-payables" element={<AgedReport key="ap" type="bill" />} />
              <Route path="reports/sales-by-customer" element={<ByContactReport key="sc" side="sales" />} />
              <Route path="reports/purchases-by-supplier" element={<ByContactReport key="ps" side="purchases" />} />
              <Route path="reports/sales-by-item" element={<ByItemReport side="sales" />} />
              <Route path="reports/tax-summary" element={<TaxSummaryReport />} />
              <Route path="reports/stock-value" element={<StockSummaryReport />} />

              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        )}
      </ToastProvider>
    </BrowserRouter>
  )
}

function Shell({ companies }: { companies: Company[] }) {
  const { companyId } = usePrefs()
  if (companies.length === 0) return <Navigate to="/welcome" replace />
  const company = companies.find((c) => c.id === companyId) ?? companies[0]

  return (
    <CompanyProvider company={company}>
      <QuickEntryProvider>
        <AppShell>
          {/* Remount pages when switching business so no state leaks between them. */}
          <Fragment key={company.id}>
            <Outlet />
          </Fragment>
        </AppShell>
      </QuickEntryProvider>
    </CompanyProvider>
  )
}
