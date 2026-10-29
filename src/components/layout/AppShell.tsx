import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  Check,
  ChevronsUpDown,
  ClipboardList,
  CloudOff,
  FileText,
  HandCoins,
  LayoutDashboard,
  Menu as MenuIcon,
  Moon,
  NotebookPen,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sun,
  X,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { db } from '../../db'
import type { Company } from '../../db/types'
import { cn } from '../../lib/cn'
import { useOnline } from '../../lib/platform'
import { useCompany } from '../../state/company'
import { setPrefs, usePrefs } from '../../state/prefs'
import { useQuickEntry } from '../QuickEntry'
import { Dialog } from '../ui/dialog'
import { Menu, MenuItem } from '../ui/menu'
import { Kbd } from '../ui/misc'
import { CommandPalette } from './CommandPalette'
import { isActive, navItems, SETTINGS_ITEM, type NavItem } from './nav'

export function Logo({ className }: { className?: string }) {
  return <img src="/logo.svg" alt="" className={cn('size-8 rounded-[9px]', className)} />
}

function NavRow({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const Icon = item.icon
  const active = isActive(item, pathname)
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
        active ? 'bg-primary-soft font-medium text-primary-ink' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      <Icon className="size-[18px] shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </Link>
  )
}

function CompanySwitcher() {
  const company = useCompany()
  const companies = useLiveQuery(() => db.companies.orderBy('name').toArray(), []) ?? []
  const navigate = useNavigate()
  return (
    <Menu
      className="w-full"
      trigger={({ toggle, open }) => (
        <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-surface-2">
          <Logo />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-fg">{company.name}</div>
            <div className="truncate text-xs text-fg-subtle">
              {company.currency} · {company.isDemo ? 'Demo data' : 'Ledgerly'}
            </div>
          </div>
          <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">Your businesses</div>
          {companies.map((c: Company) => (
            <MenuItem
              key={c.id}
              active={c.id === company.id}
              icon={c.id === company.id ? <Check /> : <span className="size-4" />}
              onClick={() => {
                close()
                setPrefs({ companyId: c.id })
                navigate('/')
              }}
            >
              {c.name}
            </MenuItem>
          ))}
          <div className="my-1 border-t border-line" />
          <MenuItem
            icon={<Plus />}
            onClick={() => {
              close()
              navigate('/welcome?new=1')
            }}
          >
            Add a business
          </MenuItem>
        </>
      )}
    </Menu>
  )
}

function StorageStatus() {
  const online = useOnline()
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-fg-subtle" title="Everything is saved in this browser and works without internet.">
      {online ? <ShieldCheck className="size-4 text-success" /> : <CloudOff className="size-4 text-warning" />}
      <span className="leading-tight">
        <span className="block font-medium text-fg-muted">{online ? 'Works offline' : 'You are offline'}</span>
        Saved on this device
      </span>
    </div>
  )
}

function SidebarContent({ onNavigate, onCreate }: { onNavigate?: () => void; onCreate: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <CompanySwitcher />
      </div>
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={() => {
            onNavigate?.()
            onCreate()
          }}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-on-primary shadow-card hover:bg-primary-hover"
        >
          <Plus className="size-4" /> Create
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="Main">
        <div className="flex flex-col gap-0.5">
          {navItems().map((item) => (
            <NavRow key={item.to} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      </nav>
      <div className="border-t border-line p-3">
        <NavRow item={SETTINGS_ITEM} onNavigate={onNavigate} />
        <StorageStatus />
      </div>
    </div>
  )
}

function ThemeToggle() {
  const { theme } = usePrefs()
  const dark = theme === 'dark' || (theme === 'system' && document.documentElement.classList.contains('dark'))
  return (
    <button
      type="button"
      onClick={() => setPrefs({ theme: dark ? 'light' : 'dark' })}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="grid size-9 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"
    >
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  )
}

/** Everything you can create, grouped like the sections, one tap away. */
function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const openQuick = useQuickEntry()
  const navigate = useNavigate()
  const { mode } = usePrefs()
  const go = (to: string) => () => navigate(to)
  const groups: { title: string; items: { icon: ReactNode; label: string; run: () => void }[] }[] = [
    {
      title: 'Sales',
      items: [
        { icon: <FileText />, label: 'Invoice', run: go('/sales/invoices/new') },
        { icon: <ClipboardList />, label: 'Quote', run: go('/sales/quotes/new') },
        { icon: <HandCoins />, label: 'Receive payment', run: go('/sales/payments/new') },
      ],
    },
    {
      title: 'Purchases',
      items: [
        { icon: <Receipt />, label: 'Expense', run: go('/purchases/expenses/new') },
        { icon: <ShoppingCart />, label: 'Bill', run: go('/purchases/bills/new') },
        { icon: <Banknote />, label: 'Pay a supplier', run: go('/purchases/payments/new') },
      ],
    },
    {
      title: 'Money',
      items: [
        { icon: <ArrowDownLeft />, label: 'Money in', run: () => openQuick('in') },
        { icon: <ArrowUpRight />, label: 'Money out', run: () => openQuick('out') },
        { icon: <ArrowLeftRight />, label: 'Transfer', run: () => openQuick('transfer') },
        ...(mode === 'accountant' ? [{ icon: <NotebookPen />, label: 'Journal entry', run: go('/journal/new') }] : []),
      ],
    },
  ]
  return (
    <Dialog open={open} onClose={onClose} title="Create" size="md">
      <div className="flex flex-col gap-5">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">{g.title}</h3>
            <div className="grid grid-cols-3 gap-2">
              {g.items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    onClose()
                    item.run()
                  }}
                  className="flex flex-col items-center gap-2 rounded-xl border border-line bg-surface px-2 py-3 text-center text-xs font-medium text-fg transition-colors hover:bg-surface-2"
                >
                  <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary-ink [&_svg]:size-5">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Dialog>
  )
}

function MobileNav({ onMore, onCreate }: { onMore: () => void; onCreate: () => void }) {
  const tab = (to: string, label: string, icon: ReactNode) => (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive: active }) => cn('flex flex-1 flex-col items-center gap-1 pt-2 pb-1.5 text-[11px] font-medium [&_svg]:size-[22px]', active ? 'text-primary-ink' : 'text-fg-subtle')}
    >
      {icon}
      {label}
    </NavLink>
  )
  return (
    <nav aria-label="Primary" className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden">
      <div className="mx-auto flex max-w-lg items-end">
        {tab('/', 'Home', <LayoutDashboard />)}
        {tab('/sales', 'Sales', <Receipt />)}
        <div className="flex flex-1 justify-center">
          <button type="button" onClick={onCreate} aria-label="Create" className="-mt-5 mb-1 grid size-14 place-items-center rounded-2xl bg-primary text-on-primary shadow-pop transition-transform active:scale-95">
            <Plus className="size-6" />
          </button>
        </div>
        {tab('/purchases', 'Purchases', <ShoppingCart />)}
        <button type="button" onClick={onMore} className="flex flex-1 flex-col items-center gap-1 pt-2 pb-1.5 text-[11px] font-medium text-fg-subtle [&_svg]:size-[22px]">
          <MenuIcon />
          More
        </button>
      </div>
    </nav>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const company = useCompany()
  const location = useLocation()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    setDrawerOpen(false)
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-surface lg:block">
        <SidebarContent onCreate={() => setCreateOpen(true)} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[min(20rem,85vw)] border-r border-line bg-surface pt-[env(safe-area-inset-top)] shadow-pop">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute top-[calc(env(safe-area-inset-top)+0.9rem)] right-3 z-10 grid size-8 place-items-center rounded-lg text-fg-subtle hover:bg-surface-2"
            >
              <X className="size-4" />
            </button>
            <SidebarContent onNavigate={() => setDrawerOpen(false)} onCreate={() => setCreateOpen(true)} />
          </div>
        </div>
      )}

      <header className="no-print sticky top-0 z-20 border-b border-line bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-lg">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex min-w-0 items-center gap-2.5 lg:hidden">
            <Logo className="size-7" />
            <span className="truncate text-[15px] font-semibold">{company.name}</span>
          </Link>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="ml-auto flex h-9 items-center gap-2 rounded-lg text-sm text-fg-subtle transition-colors hover:text-fg max-lg:w-9 max-lg:justify-center lg:ml-0 lg:w-full lg:max-w-md lg:border lg:border-line lg:bg-surface lg:px-3 lg:shadow-card"
            aria-label="Search"
          >
            <Search className="size-[18px] shrink-0 lg:size-4" />
            <span className="hidden flex-1 text-left lg:inline">Search or jump to…</span>
            <span className="hidden gap-1 lg:flex">
              <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <div className="flex items-center gap-1 lg:ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pt-8 lg:pb-16">{children}</main>

      <MobileNav onMore={() => setDrawerOpen(true)} onCreate={() => setCreateOpen(true)} />
      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
