import { ArrowRight, BookOpenText, Boxes, Clock, FileBarChart, Landmark, Receipt, Scale, ShoppingCart, TrendingUp, Users, Wallet, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { PageHeader } from '../../components/ui/misc'
import { useCompany } from '../../state/company'
import { usePrefs } from '../../state/prefs'

interface ReportCard {
  title: string
  text: string
  icon: LucideIcon
  to: string
  accountant?: boolean
  inventory?: boolean
}

const GROUPS: { title: string; reports: ReportCard[] }[] = [
  {
    title: 'Business overview',
    reports: [
      { title: 'Profit & loss', text: 'Income, expenses and profit, with period comparison.', icon: TrendingUp, to: '/reports/profit-and-loss' },
      { title: 'Balance sheet', text: 'What you own, what you owe, and your equity.', icon: Landmark, to: '/reports/balance-sheet' },
      { title: 'Cash flow', text: 'Where cash came from and where it went.', icon: Wallet, to: '/reports/cash-flow' },
    ],
  },
  {
    title: 'Sales & customers',
    reports: [
      { title: 'Aged receivables', text: 'Who owes you, and how overdue it is.', icon: Clock, to: '/reports/aged-receivables' },
      { title: 'Sales by customer', text: 'Your best customers this period.', icon: Users, to: '/reports/sales-by-customer' },
      { title: 'Sales by item', text: 'What sells, and how much.', icon: Receipt, to: '/reports/sales-by-item' },
    ],
  },
  {
    title: 'Purchases & suppliers',
    reports: [
      { title: 'Aged payables', text: 'What you owe suppliers, and when.', icon: Clock, to: '/reports/aged-payables' },
      { title: 'Purchases by supplier', text: 'Who you spend the most with.', icon: ShoppingCart, to: '/reports/purchases-by-supplier' },
      { title: 'Stock value', text: 'Units on hand and their cost.', icon: Boxes, to: '/reports/stock-value', inventory: true },
    ],
  },
  {
    title: 'Tax & accountant',
    reports: [
      { title: 'Tax summary', text: 'Tax collected and paid, ready for your return.', icon: FileBarChart, to: '/reports/tax-summary' },
      { title: 'Trial balance', text: 'Every account balance as debits and credits.', icon: Scale, to: '/reports/trial-balance', accountant: true },
      { title: 'General ledger', text: 'Every transaction in every account.', icon: BookOpenText, to: '/reports/general-ledger', accountant: true },
    ],
  },
]

export function ReportsHome() {
  const company = useCompany()
  const { mode } = usePrefs()
  return (
    <div>
      <PageHeader title="Reports" description="Every report updates instantly, works offline, and can be printed or exported." />
      <div className="flex flex-col gap-8">
        {GROUPS.map((g) => {
          const visible = g.reports.filter((r) => !r.inventory || company.features.inventory)
          return (
            <section key={g.title}>
              <h2 className="mb-3 text-sm font-semibold text-fg-muted">{g.title}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((r) => {
                  const Icon = r.icon
                  return (
                    <Link key={r.to} to={r.to} className="group flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-ink">
                        <Icon className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                          {r.title}
                          {r.accountant && mode === 'simple' && <span className="text-[10px] font-semibold tracking-wide text-fg-subtle uppercase">For accountants</span>}
                        </span>
                        <span className="mt-0.5 block text-[13px] text-fg-subtle">{r.text}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
