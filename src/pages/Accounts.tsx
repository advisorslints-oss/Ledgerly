import { ArrowRight, BookOpen, Lock, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ACCOUNT_TYPES, subtypeInfo, TYPE_HELP, TYPE_LABELS } from '../accounting/accounts'
import { naturalBalance, totalsByAccount } from '../accounting/reports'
import { AccountDialog } from '../components/AccountDialog'
import { Button } from '../components/ui/button'
import { Input, Switch } from '../components/ui/form'
import { Badge, Card, EmptyState, Help, PageHeader, Segmented, Spinner } from '../components/ui/misc'
import type { AccountType } from '../db/types'
import { cn } from '../lib/cn'
import { today } from '../lib/dates'
import { useCompany, useFormat } from '../state/company'
import { useAccounts, useLines } from '../state/data'
import { usePrefs } from '../state/prefs'

export function Accounts() {
  const company = useCompany()
  const f = useFormat()
  const { mode } = usePrefs()
  const navigate = useNavigate()
  const showCodes = mode === 'accountant'
  const [params, setParams] = useSearchParams()
  const accounts = useAccounts(company.id)
  const lines = useLines(company.id, undefined, today())
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | AccountType>('all')
  const [showArchived, setShowArchived] = useState(false)
  const creating = params.get('new') === '1'

  const balances = useMemo(() => totalsByAccount(lines ?? []), [lines])

  const groups = useMemo(() => {
    if (!accounts) return []
    const q = query.trim().toLowerCase()
    return ACCOUNT_TYPES.filter((t) => filter === 'all' || t === filter)
      .map((type) => {
        const items = accounts
          .filter((a) => a.type === type && (showArchived || !a.archived))
          .filter((a) => !q || a.name.toLowerCase().includes(q) || a.code.toLowerCase().startsWith(q) || subtypeInfo(a.subtype).label.toLowerCase().includes(q))
          .sort((x, y) => x.code.localeCompare(y.code))
          .map((a) => ({ account: a, balance: naturalBalance(a.type, balances.get(a.id) ?? { debit: 0, credit: 0 }) }))
        return { type, items, total: items.reduce((s, i) => s + i.balance, 0) }
      })
      .filter((g) => g.items.length)
  }, [accounts, query, filter, showArchived, balances])

  if (!accounts) return <Spinner />

  return (
    <div>
      <PageHeader
        description="Every amount you record lands in one of these. Click an account to see its history."
        actions={
          <Button variant="primary" icon={<Plus />} onClick={() => setParams({ new: '1' })}>
            New account
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search accounts" aria-label="Search accounts" className="pl-9" />
        </div>
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:px-0">
          <Segmented
            label="Account type"
            value={filter}
            onChange={setFilter}
            options={[{ value: 'all' as const, label: 'All' }, ...ACCOUNT_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))]}
          />
        </div>
        <div className="lg:ml-auto">
          <Switch checked={showArchived} onChange={setShowArchived} label="Show archived" />
        </div>
      </div>

      {groups.length === 0 ? (
        <Card>
          <EmptyState icon={<BookOpen />} title="No accounts match" description="Try a different search or filter." />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <Card key={g.type} className="overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2/50 px-5 py-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  {TYPE_LABELS[g.type]}
                  <Help>{TYPE_HELP[g.type]}</Help>
                </h2>
                <span className="text-sm font-semibold tabular-nums">{f.money(g.total)}</span>
              </div>
              <ul className="divide-y divide-line">
                {g.items.map(({ account, balance }) => (
                  <li key={account.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/accounts/${account.id}`)}
                      className="group flex w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-surface-2/60"
                    >
                      {showCodes && <span className="w-12 shrink-0 text-xs text-fg-subtle tabular-nums">{account.code}</span>}
                      <span className="min-w-0 flex-1">
                        <span className={cn('flex items-center gap-2 text-sm font-medium', account.archived ? 'text-fg-subtle' : 'text-fg')}>
                          <span className="truncate">{account.name}</span>
                          {account.systemKey && <Lock className="size-3 shrink-0 text-fg-subtle" aria-label="Used by the app" />}
                          {account.archived && <Badge>Archived</Badge>}
                        </span>
                        <span className="block truncate text-xs text-fg-subtle">{subtypeInfo(account.subtype).label}</span>
                      </span>
                      <span className={cn('text-sm tabular-nums', balance < 0 ? 'text-danger' : balance === 0 ? 'text-fg-subtle' : 'text-fg')}>{f.money(balance)}</span>
                      <ArrowRight className="hidden size-4 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100 sm:block" />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          <p className="text-center text-xs text-fg-subtle">
            Balances as of today. <Link to="/reports/trial-balance" className="underline-offset-2 hover:underline">See the trial balance</Link>
          </p>
        </div>
      )}

      <AccountDialog
        open={creating}
        onClose={() => setParams({}, { replace: true })}
        accounts={accounts}
        onSaved={(a) => navigate(`/accounts/${a.id}`, { replace: true })}
      />
    </div>
  )
}
