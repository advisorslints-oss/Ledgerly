import { useLiveQuery } from 'dexie-react-hooks'
import { Fragment } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router'
import { AppShell } from './components/layout/AppShell'
import { QuickEntryProvider } from './components/QuickEntry'
import { Spinner } from './components/ui/misc'
import { ToastProvider } from './components/ui/toast'
import { db } from './db'
import type { Company } from './db/types'
import { AccountDetail } from './pages/AccountDetail'
import { Accounts } from './pages/Accounts'
import { ComingSoon, NotFound } from './pages/ComingSoon'
import { Dashboard } from './pages/Dashboard'
import { Journal } from './pages/Journal'
import { JournalEntryForm } from './pages/JournalEntryForm'
import { JournalEntryView } from './pages/JournalEntryView'
import { Onboarding } from './pages/Onboarding'
import { OpeningBalances } from './pages/OpeningBalances'
import { BalanceSheetReport } from './pages/reports/BalanceSheet'
import { ProfitLossReport } from './pages/reports/ProfitLoss'
import { ReportsHome } from './pages/reports/ReportsHome'
import { TrialBalanceReport } from './pages/reports/TrialBalance'
import { Settings } from './pages/Settings'
import { CompanyProvider } from './state/company'
import { usePrefs } from './state/prefs'

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
            <Route element={<Shell companies={companies} />}>
              <Route index element={<Dashboard />} />
              <Route path="accounts" element={<Accounts />} />
              <Route path="accounts/opening-balances" element={<OpeningBalances />} />
              <Route path="accounts/:id" element={<AccountDetail />} />
              <Route path="journal" element={<Journal />} />
              <Route path="journal/new" element={<JournalEntryForm />} />
              <Route path="journal/:id" element={<JournalEntryView />} />
              <Route path="reports" element={<ReportsHome />} />
              <Route path="reports/profit-and-loss" element={<ProfitLossReport />} />
              <Route path="reports/balance-sheet" element={<BalanceSheetReport />} />
              <Route path="reports/trial-balance" element={<TrialBalanceReport />} />
              <Route path="settings" element={<Settings />} />
              <Route path="soon/:module" element={<ComingSoon />} />
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
