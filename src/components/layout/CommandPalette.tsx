import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BookOpen, CornerDownLeft, FilePlus2, Moon, NotebookPen, Search, Sun, UserCog, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { db } from '../../db'
import { cn } from '../../lib/cn'
import { useCompany } from '../../state/company'
import { setPrefs, usePrefs } from '../../state/prefs'
import { useQuickEntry } from '../QuickEntry'
import { Kbd } from '../ui/misc'
import { navGroups, SETTINGS_ITEM } from './nav'

interface Command {
  id: string
  label: string
  hint?: string
  group: string
  icon: LucideIcon
  keywords?: string
  run: () => void
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onMouseDown={(e) => e.target === ref.current && onClose()}
      className="mx-auto mt-[10vh] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-2xl border border-line bg-surface p-0 shadow-pop"
    >
      {open && <PaletteBody onClose={onClose} />}
    </dialog>
  )
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const company = useCompany()
  const prefs = usePrefs()
  const navigate = useNavigate()
  const openQuick = useQuickEntry()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const accounts = useLiveQuery(() => db.accounts.where('companyId').equals(company.id).toArray(), [company.id]) ?? []
  const entries =
    useLiveQuery(() => db.journalEntries.where('[companyId+date]').between([company.id, ''], [company.id, '￿']).reverse().limit(300).toArray(), [company.id]) ??
    []

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to)
    const dark = document.documentElement.classList.contains('dark')
    const list: Command[] = [
      { id: 'in', label: 'Record money in', group: 'Actions', icon: ArrowDownLeft, keywords: 'income sale receipt deposit', run: () => openQuick('in') },
      { id: 'out', label: 'Record money out', group: 'Actions', icon: ArrowUpRight, keywords: 'expense payment spend bill', run: () => openQuick('out') },
      { id: 'transfer', label: 'Transfer between accounts', group: 'Actions', icon: ArrowLeftRight, run: () => openQuick('transfer') },
      { id: 'je', label: 'New journal entry', group: 'Actions', icon: NotebookPen, keywords: 'debit credit manual', run: go('/journal/new') },
      { id: 'acct', label: 'New account', group: 'Actions', icon: FilePlus2, keywords: 'chart category', run: go('/accounts?new=1') },
      {
        id: 'theme',
        label: dark ? 'Switch to light theme' : 'Switch to dark theme',
        group: 'Actions',
        icon: dark ? Sun : Moon,
        run: () => setPrefs({ theme: dark ? 'light' : 'dark' }),
      },
      {
        id: 'mode',
        label: prefs.mode === 'simple' ? 'Switch to accountant mode' : 'Switch to simple mode',
        group: 'Actions',
        icon: UserCog,
        run: () => setPrefs({ mode: prefs.mode === 'simple' ? 'accountant' : 'simple' }),
      },
    ]
    for (const item of [...navGroups(company, prefs.mode).flatMap((g) => g.items), SETTINGS_ITEM]) {
      list.push({ id: `nav-${item.to}`, label: item.label, hint: item.soon ? 'Coming soon' : undefined, group: 'Go to', icon: item.icon, run: go(item.to) })
    }
    for (const r of [
      ['Profit & loss', '/reports/profit-and-loss', 'income statement p&l'],
      ['Balance sheet', '/reports/balance-sheet', 'assets liabilities'],
      ['Trial balance', '/reports/trial-balance', 'tb'],
      ['Opening balances', '/accounts/opening-balances', 'start'],
    ]) {
      list.push({ id: `nav-${r[1]}`, label: r[0], group: 'Go to', icon: BookOpen, keywords: r[2], run: go(r[1]) })
    }
    return list
  }, [company, prefs.mode, navigate, openQuick])

  const q = query.trim().toLowerCase()
  const results = useMemo(() => {
    const match = (s: string) => s.toLowerCase().includes(q)
    const cmds = commands.filter((c) => !q || match(c.label) || (c.keywords && match(c.keywords)))
    if (!q) return cmds
    const acctResults: Command[] = accounts
      .filter((a) => match(a.name) || a.code.startsWith(q))
      .slice(0, 6)
      .map((a) => ({ id: a.id, label: a.name, hint: a.code, group: 'Accounts', icon: BookOpen, run: () => navigate(`/accounts/${a.id}`) }))
    const entryResults: Command[] = entries
      .filter((e) => match(e.number) || match(e.memo) || (e.reference && match(e.reference)))
      .slice(0, 6)
      .map((e) => ({ id: e.id, label: e.memo || e.number, hint: `${e.number} · ${e.date}`, group: 'Transactions', icon: NotebookPen, run: () => navigate(`/journal/${e.id}`) }))
    return [...cmds, ...acctResults, ...entryResults]
  }, [commands, accounts, entries, q, navigate])

  useEffect(() => setActive(0), [q])

  const run = (c: Command) => {
    onClose()
    c.run()
  }
  const move = (delta: number) => {
    const next = Math.max(0, Math.min(results.length - 1, active + delta))
    setActive(next)
    listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  let lastGroup = ''
  return (
    <div className="flex max-h-[70dvh] flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search className="size-4 shrink-0 text-fg-subtle" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              move(1)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              move(-1)
            } else if (e.key === 'Enter' && results[active]) {
              e.preventDefault()
              run(results[active])
            }
          }}
          placeholder="Search actions, pages, accounts, transactions…"
          aria-label="Search"
          className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-fg placeholder:text-fg-subtle focus:outline-none"
        />
        <Kbd>Esc</Kbd>
      </div>
      <div ref={listRef} className="overflow-y-auto p-2">
        {results.length === 0 && <p className="px-3 py-10 text-center text-sm text-fg-subtle">Nothing found for “{query}”</p>}
        {results.map((c, i) => {
          const header = c.group !== lastGroup ? c.group : null
          lastGroup = c.group
          const Icon = c.icon
          return (
            <div key={`${c.group}-${c.id}`}>
              {header && <div className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">{header}</div>}
              <button
                type="button"
                data-index={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(c)}
                className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm', i === active ? 'bg-surface-2' : '')}
              >
                <Icon className="size-4 shrink-0 text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate text-fg">{c.label}</span>
                {c.hint && <span className="shrink-0 text-xs text-fg-subtle">{c.hint}</span>}
                {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-fg-subtle" />}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
