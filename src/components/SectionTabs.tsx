import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { cn } from '../lib/cn'

export interface SectionTab {
  to: string
  label: string
  count?: number
  end?: boolean
}

/** The tab row under a section title (Sales, Purchases, Banking…). Scrolls sideways on phones. */
export function SectionTabs({ tabs }: { tabs: SectionTab[] }) {
  return (
    <nav aria-label="Section" className="no-print -mx-4 mb-6 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <div className="flex gap-1">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                isActive ? 'border-primary text-fg' : 'border-transparent text-fg-subtle hover:text-fg',
              )
            }
          >
            {t.label}
            {!!t.count && <span className="rounded-full bg-danger-soft px-1.5 text-[11px] font-semibold text-danger tabular-nums">{t.count}</span>}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

export function SectionHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-[26px]">{title}</h1>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
