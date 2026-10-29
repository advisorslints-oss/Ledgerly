import { Check, ChevronDown } from 'lucide-react'
import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ACCOUNT_TYPES, TYPE_LABELS } from '../accounting/accounts'
import type { Account, AccountType } from '../db/types'
import { cn } from '../lib/cn'
import { inputClass } from './ui/form'

interface Props {
  accounts: Account[]
  value: string
  onChange: (id: string) => void
  showCodes: boolean
  /** Order of type groups in the list; defaults to the chart order. */
  groupOrder?: AccountType[]
  placeholder?: string
  id?: string
  invalid?: boolean
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
}

/** Searchable account selector, grouped by account type. Works with keyboard and touch. */
export function AccountPicker({
  accounts,
  value,
  onChange,
  showCodes,
  groupOrder = ACCOUNT_TYPES,
  placeholder = 'Choose an account',
  id,
  invalid,
  className,
  ...aria
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<CSSProperties>({})

  // The list is fixed-positioned so scrolling containers (dialogs, tables) never clip it.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = inputRef.current?.getBoundingClientRect()
      if (!rect) return
      const below = window.innerHeight - rect.bottom
      const width = Math.max(rect.width, 256)
      const left = Math.min(rect.left, window.innerWidth - width - 8)
      setPosition(
        below < 300 && rect.top > below
          ? { bottom: window.innerHeight - rect.top + 4, left, width, maxHeight: Math.min(288, rect.top - 12) }
          : { top: rect.bottom + 4, left, width, maxHeight: Math.min(288, below - 12) },
      )
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const selected = accounts.find((a) => a.id === value)
  const label = (a: Account) => (showCodes ? `${a.code} · ${a.name}` : a.name)

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const visible = accounts.filter(
      (a) => (!a.archived || a.id === value) && (!q || a.name.toLowerCase().includes(q) || a.code.toLowerCase().startsWith(q)),
    )
    return groupOrder
      .map((type) => ({
        type,
        items: visible.filter((a) => a.type === type).sort((x, y) => x.code.localeCompare(y.code)),
      }))
      .filter((g) => g.items.length)
  }, [accounts, query, groupOrder, value])
  const flat = groups.flatMap((g) => g.items)

  const choose = (a: Account) => {
    onChange(a.id)
    setOpen(false)
    setQuery('')
  }

  const move = (delta: number) => {
    const next = Math.max(0, Math.min(flat.length - 1, active + delta))
    setActive(next)
    listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className={cn('relative', className)}>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        autoComplete="off"
        value={open ? query : selected ? label(selected) : ''}
        placeholder={selected && open ? label(selected) : placeholder}
        onFocus={() => {
          setOpen(true)
          setActive(Math.max(0, flat.findIndex((a) => a.id === value)))
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (!open) setOpen(true)
            else move(1)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            move(-1)
          } else if (e.key === 'Enter' && open) {
            e.preventDefault()
            if (flat[active]) choose(flat[active])
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation()
            setOpen(false)
            setQuery('')
          }
        }}
        className={cn(inputClass, 'pr-8 text-ellipsis')}
        {...aria}
      />
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          onMouseDown={(e) => e.preventDefault()}
          style={position}
          className="fixed z-[60] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop"
        >
          {flat.length === 0 && <p className="px-3 py-6 text-center text-sm text-fg-subtle">No matching accounts</p>}
          {groups.map((g) => (
            <div key={g.type} role="group" aria-label={TYPE_LABELS[g.type]}>
              <div className="sticky top-0 bg-surface px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">
                {TYPE_LABELS[g.type]}
              </div>
              {g.items.map((a) => {
                const index = flat.indexOf(a)
                return (
                  <div
                    key={a.id}
                    role="option"
                    aria-selected={a.id === value}
                    data-index={index}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(a)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm',
                      index === active ? 'bg-surface-2' : '',
                    )}
                  >
                    {showCodes && <span className="w-11 shrink-0 text-xs text-fg-subtle tabular-nums">{a.code}</span>}
                    <span className="min-w-0 flex-1 truncate text-fg">{a.name}</span>
                    {a.archived && <span className="text-[11px] text-fg-subtle">Archived</span>}
                    {a.id === value && <Check className="size-4 shrink-0 text-primary-ink" />}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
