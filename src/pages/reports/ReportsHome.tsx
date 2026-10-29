import { ArrowRight, Clock, FileBarChart, Landmark, Scale, TrendingUp, Users, Wallet, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { Badge, PageHeader } from '../../components/ui/misc'
import { cn } from '../../lib/cn'
import { usePrefs } from '../../state/prefs'

interface ReportCard {
  title: string
  text: string
  icon: LucideIcon
  to?: string
}

export function ReportsHome() {
  const { mode } = usePrefs()
  const ready: ReportCard[] = [
    { title: 'Profit & loss', text: 'Income, expenses and profit for any period.', icon: TrendingUp, to: '/reports/profit-and-loss' },
    { title: 'Balance sheet', text: 'What you own, what you owe, and your equity.', icon: Landmark, to: '/reports/balance-sheet' },
    { title: 'Trial balance', text: 'Every account balance as debits and credits.', icon: Scale, to: '/reports/trial-balance' },
  ]
  const soon: ReportCard[] = [
    { title: 'Cash flow statement', text: 'Where cash came from and where it went.', icon: Wallet },
    { title: 'Aged receivables', text: 'Who owes you, and for how long.', icon: Clock },
    { title: 'Aged payables', text: 'Bills due and overdue.', icon: Clock },
    { title: 'Sales by customer', text: 'Your best customers at a glance.', icon: Users },
    { title: 'Tax summary', text: 'Tax collected and paid, ready for filing.', icon: FileBarChart },
  ]
  const visible = mode === 'simple' ? ready.filter((r) => r.title !== 'Trial balance') : ready

  return (
    <div>
      <PageHeader title="Reports" description="Every report updates instantly as you record transactions, and works offline. Print or export any of them." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((r) => (
          <Tile key={r.title} card={r} />
        ))}
      </div>
      <h2 className="mt-10 mb-3 text-sm font-semibold text-fg-muted">Coming next</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {soon.map((r) => (
          <Tile key={r.title} card={r} />
        ))}
        {mode === 'simple' && <Tile card={{ ...ready[2], text: 'For accountants: all balances as debits and credits.' }} />}
      </div>
    </div>
  )
}

function Tile({ card }: { card: ReportCard }) {
  const Icon = card.icon
  const body = (
    <>
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', card.to ? 'bg-primary-soft text-primary-ink' : 'bg-surface-2 text-fg-subtle')}>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-semibold text-fg">
          {card.title}
          {!card.to && <Badge>Soon</Badge>}
        </span>
        <span className="mt-0.5 block text-[13px] text-fg-subtle">{card.text}</span>
      </span>
      {card.to && <ArrowRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />}
    </>
  )
  const cls = 'group flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card'
  return card.to ? (
    <Link to={card.to} className={cn(cls, 'transition-colors hover:border-line-strong')}>
      {body}
    </Link>
  ) : (
    <div className={cn(cls, 'opacity-75')}>{body}</div>
  )
}
