import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowDownLeft,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  Download,
  Info,
  Landmark,
  Wallet,
  X,
} from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { computeTrialBalance, monthlyResults, naturalBalance, netIncome, totalsByAccount } from '../accounting/reports'
import { IncomeExpenseChart } from '../components/charts/IncomeExpenseChart'
import { useQuickEntry } from '../components/QuickEntry'
import { Button, LinkButton } from '../components/ui/button'
import { Card, CardHeader, Spinner } from '../components/ui/misc'
import { db } from '../db'
import type { Account, JournalEntry } from '../db/types'
import { cn } from '../lib/cn'
import { addMonths, fiscalYearStart, monthLabel, startOfMonth, today } from '../lib/dates'
import { isStandalone } from '../lib/platform'
import { useCompany, useFormat } from '../state/company'
import { useAccounts, useLines } from '../state/data'
import { setPrefs, usePrefs } from '../state/prefs'

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const MONEY = new Set(['cash', 'bank'])

export function Dashboard() {
  const company = useCompany()
  const f = useFormat()
  const openQuick = useQuickEntry()
  const accounts = useAccounts(company.id)
  const lines = useLines(company.id)
  const recent = useLiveQuery(
    () => db.journalEntries.where('[companyId+date]').between([company.id, ''], [company.id, '￿']).reverse().limit(6).toArray(),
    [company.id],
  )
  const sources = useLiveQuery(async () => {
    const entries = await db.journalEntries.where('companyId').equals(company.id).toArray()
    return { opening: entries.some((e) => e.source === 'opening'), manual: entries.some((e) => e.source === 'manual'), count: entries.length }
  }, [company.id])

  const stats = useMemo(() => {
    if (!accounts || !lines) return null
    const now = today()
    const upToToday = lines.filter((l) => l.date <= now)
    const totals = totalsByAccount(upToToday)
    const balance = (a: Account) => naturalBalance(a.type, totals.get(a.id) ?? { debit: 0, credit: 0 })
    const sum = (pred: (a: Account) => boolean) => accounts.filter(pred).reduce((s, a) => s + balance(a), 0)

    const moneyAccounts = accounts
      .filter((a) => MONEY.has(a.subtype) && (!a.archived || balance(a) !== 0))
      .map((a) => ({ account: a, balance: balance(a) }))
      .sort((x, y) => y.balance - x.balance)
    const fyStart = fiscalYearStart(now, company.fiscalYearStartMonth)
    const thisMonth = startOfMonth(now)
    const months = Array.from({ length: 6 }, (_, i) => addMonths(thisMonth, i - 5))
    const monthly = monthlyResults(accounts, lines, months)
    const tb = computeTrialBalance(accounts, lines)

    return {
      cash: moneyAccounts.reduce((s, m) => s + m.balance, 0),
      moneyAccounts,
      receivable: sum((a) => a.subtype === 'receivable'),
      payable: sum((a) => a.subtype === 'payable' || a.subtype === 'credit_card'),
      fyProfit: netIncome(accounts, totalsByAccount(upToToday.filter((l) => l.date >= fyStart))),
      monthly,
      thisMonth: monthly[5],
      lastMonth: monthly[4],
      balanced: tb.totalDebit === tb.totalCredit,
      negativeMoney: moneyAccounts.filter((m) => m.balance < 0),
      oldestEntry: lines.reduce((min, l) => (l.date < min ? l.date : min), now),
    }
  }, [accounts, lines, company.fiscalYearStartMonth])

  if (!stats || !accounts || !recent || !sources) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner />
      </div>
    )
  }

  const monthName = monthLabel(stats.thisMonth.month, company.locale)
  const lastMonthName = monthLabel(stats.lastMonth.month, company.locale)
  const profitDelta = stats.thisMonth.profit - stats.lastMonth.profit

  return (
    <div>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-fg-subtle">{greeting()}</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight sm:text-[26px]">{company.name}</h1>
        </div>
        <div className="hidden gap-2 sm:flex">
          <Button onClick={() => openQuick('out')} icon={<ArrowUpRight />}>
            Money out
          </Button>
          <Button variant="primary" onClick={() => openQuick('in')} icon={<ArrowDownLeft />}>
            Money in
          </Button>
        </div>
      </header>

      <GettingStarted hasOpening={sources.opening || !!company.isDemo} hasManual={sources.manual} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile label="Cash & bank" value={f.money(stats.cash)} note={`${stats.moneyAccounts.length} account${stats.moneyAccounts.length === 1 ? '' : 's'}`} to="/reports/balance-sheet" />
        <StatTile label="Owed to you" value={f.money(stats.receivable)} note="By customers" to="/reports/balance-sheet" />
        <StatTile label="You owe" value={f.money(stats.payable)} note="Suppliers & cards" to="/reports/balance-sheet" />
        <StatTile
          label={`Profit in ${monthName}`}
          value={f.money(stats.thisMonth.profit)}
          negative={stats.thisMonth.profit < 0}
          to="/reports/profit-and-loss"
          note={
            stats.lastMonth.income || stats.lastMonth.expenses ? (
              <span className={cn('inline-flex items-center gap-0.5 font-medium', profitDelta >= 0 ? 'text-success' : 'text-danger')}>
                {profitDelta >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                {f.money(Math.abs(profitDelta), { compact: true })}
                <span className="font-normal text-fg-subtle">vs {lastMonthName}</span>
              </span>
            ) : (
              'This month so far'
            )
          }
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:mt-6 lg:grid-cols-3 lg:gap-6">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Income vs expenses"
            description={`Last 6 months · ${f.money(stats.fyProfit)} profit this financial year`}
            actions={
              <LinkButton to="/reports/profit-and-loss" variant="ghost" size="sm">
                Details <ArrowRight />
              </LinkButton>
            }
          />
          <div className="px-5 pb-5">
            <IncomeExpenseChart data={stats.monthly} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Cash position" description="Money available right now" />
          <ul className="px-2 pb-3">
            {stats.moneyAccounts.length === 0 && <li className="px-3 py-4 text-sm text-fg-subtle">No cash or bank accounts yet.</li>}
            {stats.moneyAccounts.map(({ account, balance }) => (
              <li key={account.id}>
                <Link to={`/accounts/${account.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-muted">
                    {account.subtype === 'cash' ? <Wallet className="size-4" /> : <Landmark className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">{account.name}</span>
                  <span className={cn('text-sm font-medium tabular-nums', balance < 0 ? 'text-danger' : 'text-fg')}>{f.money(balance)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent activity"
            actions={
              <LinkButton to="/journal" variant="ghost" size="sm">
                View all <ArrowRight />
              </LinkButton>
            }
          />
          <RecentList entries={recent} />
        </Card>

        <HealthCheck
          balanced={stats.balanced}
          negativeMoney={stats.negativeMoney.map((m) => m.account.name)}
          hasEntries={sources.count > 0}
          oldestEntry={stats.oldestEntry}
        />
      </div>
    </div>
  )
}

function StatTile({ label, value, note, to, negative }: { label: string; value: string; note: ReactNode; to: string; negative?: boolean }) {
  return (
    <Link to={to} className="group rounded-2xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong sm:p-5">
      <p className="truncate text-[13px] text-fg-muted">{label}</p>
      <p className={cn('mt-1.5 truncate text-lg font-semibold tracking-tight sm:text-2xl', negative ? 'text-danger' : 'text-fg')}>{value}</p>
      <p className="mt-1 truncate text-xs text-fg-subtle">{note}</p>
    </Link>
  )
}

function RecentList({ entries }: { entries: JournalEntry[] }) {
  const f = useFormat()
  const openQuick = useQuickEntry()
  if (entries.length === 0) {
    return (
      <div className="px-5 pb-6">
        <p className="text-sm text-fg-subtle">Nothing recorded yet.</p>
        <Button className="mt-3" size="sm" variant="soft" onClick={() => openQuick('in')}>
          Record your first transaction
        </Button>
      </div>
    )
  }
  return (
    <ul className="px-2 pb-3">
      {entries.map((e) => (
        <li key={e.id}>
          <Link to={`/journal/${e.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
            <span className="w-14 shrink-0 text-xs text-fg-subtle">{f.date(e.date, 'short')}</span>
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-sm text-fg', e.status === 'reversed' && 'line-through decoration-fg-subtle')}>{e.memo || 'Journal entry'}</span>
              <span className="block text-xs text-fg-subtle">{e.number}</span>
            </span>
            <span className="text-sm font-medium text-fg tabular-nums">{f.money(e.total)}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function HealthCheck({ balanced, negativeMoney, hasEntries, oldestEntry }: { balanced: boolean; negativeMoney: string[]; hasEntries: boolean; oldestEntry: string }) {
  const company = useCompany()
  const f = useFormat()
  const daysSinceBackup = company.lastBackupAt ? Math.floor((Date.now() - company.lastBackupAt) / 86_400_000) : null
  const fyStart = fiscalYearStart(today(), company.fiscalYearStartMonth)

  const items: { tone: 'good' | 'warn' | 'info'; title: string; text: string; to?: string }[] = [
    balanced
      ? { tone: 'good', title: 'Books are balanced', text: 'Total debits equal total credits.' }
      : { tone: 'warn', title: 'Books are out of balance', text: 'Open the trial balance to investigate.', to: '/reports/trial-balance' },
  ]
  if (negativeMoney.length) {
    items.push({ tone: 'warn', title: 'Negative balance', text: `${negativeMoney.join(', ')} is below zero. A deposit may be missing.` })
  }
  if (hasEntries) {
    if (daysSinceBackup === null || daysSinceBackup > 7) {
      items.push({
        tone: 'warn',
        title: daysSinceBackup === null ? 'No backup yet' : `Last backup ${daysSinceBackup} days ago`,
        text: 'Your data lives on this device. Download a backup to keep it safe.',
        to: '/settings?tab=data',
      })
    } else {
      items.push({ tone: 'good', title: 'Backed up recently', text: daysSinceBackup === 0 ? 'Backed up today.' : `${daysSinceBackup} day(s) ago.` })
    }
  }
  if (!company.lockDate && oldestEntry < fyStart) {
    items.push({ tone: 'info', title: 'Lock last year', text: `Lock entries before ${f.date(fyStart)} so closed periods can't change.`, to: '/settings?tab=lock' })
  }

  return (
    <Card>
      <CardHeader title="Health check" />
      <ul className="flex flex-col gap-1 px-2 pb-3">
        {items.map((item) => {
          const Icon = item.tone === 'good' ? CircleCheck : item.tone === 'warn' ? CircleAlert : Info
          const body = (
            <>
              <Icon className={cn('mt-0.5 size-4 shrink-0', item.tone === 'good' ? 'text-success' : item.tone === 'warn' ? 'text-warning' : 'text-primary-ink')} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">{item.title}</span>
                <span className="block text-xs text-fg-subtle">{item.text}</span>
              </span>
              {item.to && <ArrowRight className="mt-0.5 size-4 shrink-0 text-fg-subtle" />}
            </>
          )
          return (
            <li key={item.title}>
              {item.to ? (
                <Link to={item.to} className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
                  {body}
                </Link>
              ) : (
                <div className="flex items-start gap-3 px-3 py-2.5">{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function GettingStarted({ hasOpening, hasManual }: { hasOpening: boolean; hasManual: boolean }) {
  const company = useCompany()
  const prefs = usePrefs()
  const openQuick = useQuickEntry()
  if (prefs.dismissedChecklist?.includes(company.id)) return null

  const steps = [
    { done: true, title: 'Create your books', action: null },
    { done: hasOpening, title: 'Enter opening balances', action: <LinkButton to="/accounts/opening-balances" size="sm" variant="soft">Start</LinkButton> },
    { done: hasManual, title: 'Record a transaction', action: <Button size="sm" variant="soft" onClick={() => openQuick('in')}>Record</Button> },
    { done: !!company.lastBackupAt, title: 'Download a backup', action: <LinkButton to="/settings?tab=data" size="sm" variant="soft" icon={<Download />}>Backup</LinkButton> },
    { done: isStandalone(), title: 'Install the app', action: <LinkButton to="/settings?tab=preferences" size="sm" variant="soft">How</LinkButton> },
  ]
  const doneCount = steps.filter((s) => s.done).length
  if (doneCount === steps.length) return null

  return (
    <Card className="mb-4 overflow-hidden lg:mb-6">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="text-[15px] font-semibold">Get set up</h2>
          <p className="mt-0.5 text-[13px] text-fg-subtle">
            {doneCount} of {steps.length} done
          </p>
        </div>
        <button
          type="button"
          aria-label="Hide setup checklist"
          onClick={() => setPrefs({ dismissedChecklist: [...(prefs.dismissedChecklist ?? []), company.id] })}
          className="grid size-8 place-items-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mx-5 mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className={cn('flex items-center gap-3 rounded-xl border p-3 lg:flex-col lg:items-start', s.done ? 'border-transparent bg-surface-2/60' : 'border-line')}
          >
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                s.done ? 'bg-success text-white dark:text-bg' : 'bg-surface-2 text-fg-muted ring-1 ring-line-strong',
              )}
            >
              {s.done ? <CircleCheck className="size-4" /> : i + 1}
            </span>
            <span className={cn('min-w-0 flex-1 text-sm font-medium', s.done ? 'text-fg-subtle line-through' : 'text-fg')}>{s.title}</span>
            {!s.done && s.action}
          </li>
        ))}
      </ol>
    </Card>
  )
}
