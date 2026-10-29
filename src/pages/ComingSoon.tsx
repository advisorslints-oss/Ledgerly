import { ArrowDownLeft, ArrowUpRight, Compass, Landmark, Package, Receipt, ShoppingCart, Users, type LucideIcon } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { useQuickEntry } from '../components/QuickEntry'
import { Button } from '../components/ui/button'
import { Card, EmptyState } from '../components/ui/misc'

const MODULES: Record<string, { title: string; icon: LucideIcon; points: string[] }> = {
  sales: {
    title: 'Sales & invoices',
    icon: Receipt,
    points: ['Quotes that turn into invoices in one click', 'Branded PDF invoices to share by email or WhatsApp', 'Recurring invoices and payment reminders', 'Credit notes and partial payments', 'Tax worked out per line'],
  },
  purchases: {
    title: 'Purchases & bills',
    icon: ShoppingCart,
    points: ['Purchase orders and supplier bills', 'Snap receipts with your phone camera', 'Bills due and overdue at a glance', 'Claimable tax tracked automatically'],
  },
  banking: {
    title: 'Banking',
    icon: Landmark,
    points: ['Import bank statements (CSV)', 'Reconcile with smart matching rules', 'Auto-categorise repeat transactions', 'Transfers between accounts'],
  },
  inventory: {
    title: 'Inventory',
    icon: Package,
    points: ['Products and services with prices', 'Stock levels with low-stock alerts', 'Average or first-in-first-out costing', 'Barcode scanning with your camera'],
  },
  contacts: {
    title: 'Customers & suppliers',
    icon: Users,
    points: ['One place for every customer and supplier', 'Balances owed by and to each contact', 'Statements you can send in a click'],
  },
}

export function ComingSoon() {
  const { module = '' } = useParams()
  const openQuick = useQuickEntry()
  const info = MODULES[module]
  if (!info) return <NotFound />
  const Icon = info.icon
  return (
    <div className="mx-auto max-w-2xl">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary-soft to-surface px-6 pt-10 pb-8 text-center sm:px-10">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary text-on-primary shadow-pop">
            <Icon className="size-7" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">{info.title}</h1>
          <p className="mt-2 text-fg-muted">Arriving in the next update. Here's what it will do:</p>
        </div>
        <ul className="grid grid-cols-1 gap-2 px-6 py-6 sm:px-10">
          {info.points.map((p) => (
            <li key={p} className="flex items-start gap-3 text-sm text-fg">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
              {p}
            </li>
          ))}
        </ul>
        <div className="border-t border-line bg-surface-2/50 px-6 py-5 sm:px-10">
          <p className="text-sm text-fg-muted">In the meantime, you can already record any money that comes in or goes out:</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" icon={<ArrowDownLeft />} onClick={() => openQuick('in')}>
              Money in
            </Button>
            <Button icon={<ArrowUpRight />} onClick={() => openQuick('out')}>
              Money out
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

export function NotFound() {
  return (
    <Card>
      <EmptyState
        icon={<Compass />}
        title="Page not found"
        description="That page doesn't exist."
        action={
          <Link to="/" className="text-sm font-medium text-primary-ink hover:underline">
            Go to the dashboard
          </Link>
        }
      />
    </Card>
  )
}
