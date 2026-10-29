import { useMemo } from 'react'
import { Outlet } from 'react-router'
import { docState } from '../accounting/documents'
import { SectionHeader, SectionTabs } from '../components/SectionTabs'
import { useCompany } from '../state/company'
import { useLedgerDocs } from '../state/data'
import { usePrefs } from '../state/prefs'

function useOverdue(type: 'invoice' | 'bill') {
  const company = useCompany()
  const { docs, settled } = useLedgerDocs(company.id)
  return useMemo(() => (docs && settled ? docs.filter((d) => d.type === type && docState(d, settled.get(d.id) ?? 0) === 'overdue').length : 0), [docs, settled, type])
}

export function SalesLayout() {
  const overdue = useOverdue('invoice')
  return (
    <div>
      <SectionHeader title="Sales" />
      <SectionTabs
        tabs={[
          { to: '/sales/invoices', label: 'Invoices', count: overdue },
          { to: '/sales/quotes', label: 'Quotes' },
          { to: '/sales/payments', label: 'Payments received' },
          { to: '/sales/credit-notes', label: 'Credit notes' },
          { to: '/sales/customers', label: 'Customers' },
        ]}
      />
      <Outlet />
    </div>
  )
}

export function PurchasesLayout() {
  const overdue = useOverdue('bill')
  return (
    <div>
      <SectionHeader title="Purchases" />
      <SectionTabs
        tabs={[
          { to: '/purchases/bills', label: 'Bills', count: overdue },
          { to: '/purchases/expenses', label: 'Expenses' },
          { to: '/purchases/orders', label: 'Purchase orders' },
          { to: '/purchases/payments', label: 'Payments made' },
          { to: '/purchases/credits', label: 'Supplier credits' },
          { to: '/purchases/suppliers', label: 'Suppliers' },
        ]}
      />
      <Outlet />
    </div>
  )
}

export function AccountingLayout() {
  const { mode } = usePrefs()
  return (
    <div>
      <SectionHeader title="Accounting" />
      <SectionTabs
        tabs={[
          { to: '/journal', label: mode === 'simple' ? 'All transactions' : 'Journal', end: true },
          { to: '/accounts', label: mode === 'simple' ? 'Accounts' : 'Chart of accounts', end: true },
          { to: '/accounts/opening-balances', label: 'Opening balances' },
        ]}
      />
      <Outlet />
    </div>
  )
}

export function BankingLayout() {
  return (
    <div>
      <SectionHeader title="Banking" />
      <SectionTabs
        tabs={[
          { to: '/banking/accounts', label: 'Accounts' },
          { to: '/banking/transactions', label: 'Transactions' },
          { to: '/banking/review', label: 'Statement review' },
          { to: '/banking/reconcile', label: 'Reconcile' },
          { to: '/banking/rules', label: 'Rules' },
        ]}
      />
      <Outlet />
    </div>
  )
}

export function ItemsLayout() {
  const company = useCompany()
  return (
    <div>
      <SectionHeader title="Items" />
      <SectionTabs
        tabs={[
          { to: '/items', label: 'Products & services', end: true },
          ...(company.features.inventory ? [{ to: '/items/stock', label: 'Stock' }] : []),
        ]}
      />
      <Outlet />
    </div>
  )
}
