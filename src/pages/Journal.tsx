import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, NotebookPen, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useQuickEntry } from '../components/QuickEntry'
import { Button, LinkButton } from '../components/ui/button'
import { Input } from '../components/ui/form'
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../components/ui/misc'
import { db } from '../db'
import type { JournalEntry } from '../db/types'
import { cn } from '../lib/cn'
import { useCompany, useFormat } from '../state/company'
import { useAccounts } from '../state/data'
import { usePrefs } from '../state/prefs'

const PAGE = 100

export function Journal() {
  const company = useCompany()
  const f = useFormat()
  const { mode } = usePrefs()
  const openQuick = useQuickEntry()
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const accounts = useAccounts(company.id)

  const entries = useLiveQuery(
    () => db.journalEntries.where('[companyId+date]').between([company.id, ''], [company.id, '￿']).reverse().toArray(),
    [company.id],
  )

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!entries) return []
    const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    if (!q) return sorted
    return sorted.filter((e) => e.number.toLowerCase().includes(q) || e.memo.toLowerCase().includes(q) || e.reference?.toLowerCase().includes(q) || f.toInput(e.total).startsWith(q))
  }, [entries, q, f])
  const visible = filtered.slice(0, limit)

  const lines = useLiveQuery(() => db.journalLines.where('entryId').anyOf(visible.map((e) => e.id)).toArray(), [visible.map((e) => e.id).join()])

  const summaries = useMemo(() => {
    const names = new Map(accounts?.map((a) => [a.id, a.name]))
    const byEntry = new Map<string, { from: string[]; to: string[] }>()
    for (const l of lines ?? []) {
      const s = byEntry.get(l.entryId) ?? { from: [], to: [] }
      const name = names.get(l.accountId) ?? '—'
      if (l.credit) s.from.push(name)
      else s.to.push(name)
      byEntry.set(l.entryId, s)
    }
    const fmt = (list: string[]) => (list.length > 1 ? `${list[0]} +${list.length - 1}` : (list[0] ?? ''))
    return new Map([...byEntry].map(([id, s]) => [id, { from: fmt(s.from), to: fmt(s.to) }]))
  }, [lines, accounts])

  if (!entries || !accounts) return <Spinner />
  const simple = mode === 'simple'

  return (
    <div>
      <PageHeader
        title={simple ? 'Transactions' : 'Journal'}
        description={simple ? 'Everything you have recorded, newest first.' : 'All journal entries, newest first. Posted entries are never edited: reverse them instead.'}
        actions={
          <>
            <Button icon={<ArrowUpRight />} onClick={() => openQuick('out')}>
              Money out
            </Button>
            <Button icon={<ArrowDownLeft />} onClick={() => openQuick('in')}>
              Money in
            </Button>
            <LinkButton to="/journal/new" variant="primary" icon={<Plus />}>
              Journal entry
            </LinkButton>
          </>
        }
      />

      <div className="relative mb-4 sm:w-80">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by description, number or amount" aria-label="Search transactions" className="pl-9" />
      </div>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<NotebookPen />}
            title={q ? 'No matching transactions' : 'No transactions yet'}
            description={q ? 'Try another search.' : 'Record money coming in or going out, and it will show up here.'}
            action={!q && <Button variant="primary" onClick={() => openQuick('in')}>Record a transaction</Button>}
          />
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((e) => (
              <EntryRow key={e.id} entry={e} summary={summaries.get(e.id)} simple={simple} money={f.money} date={f.date} />
            ))}
          </ul>
        )}
        {filtered.length > limit && (
          <div className="border-t border-line p-3 text-center">
            <Button variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({filtered.length - limit} left)
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}

function EntryRow({
  entry,
  summary,
  simple,
  money,
  date,
}: {
  entry: JournalEntry
  summary?: { from: string; to: string }
  simple: boolean
  money: (n: number) => string
  date: (iso: string, style?: 'short' | 'medium') => string
}) {
  return (
    <li>
      <Link to={`/journal/${entry.id}`} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-2/60">
        <div className="w-16 shrink-0 text-xs text-fg-subtle sm:w-24">{date(entry.date)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('truncate text-sm font-medium text-fg', entry.status === 'reversed' && 'text-fg-subtle line-through')}>
              {entry.memo || (entry.source === 'opening' ? 'Opening balances' : 'Journal entry')}
            </span>
            {entry.status === 'reversed' && <Badge tone="warning">Reversed</Badge>}
            {entry.source === 'reversal' && <Badge>Reversal</Badge>}
            {entry.source === 'opening' && <Badge tone="primary">Opening</Badge>}
          </div>
          {summary && (
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
              {!simple && <span className="shrink-0 tabular-nums">{entry.number}</span>}
              {!simple && <span aria-hidden>·</span>}
              <span className="truncate">{summary.from}</span>
              <ArrowRight className="size-3 shrink-0" aria-label="to" />
              <span className="truncate">{summary.to}</span>
            </div>
          )}
        </div>
        <div className="text-right text-sm font-semibold text-fg tabular-nums">{money(entry.total)}</div>
      </Link>
    </li>
  )
}
