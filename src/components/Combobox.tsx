import { Check, ChevronDown, Plus } from 'lucide-react'
import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { inputClass } from './ui/form'

export interface ComboOption {
  id: string
  label: string
  hint?: string
  group?: string
}

interface Props {
  options: ComboOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  id?: string
  invalid?: boolean
  className?: string
  /** Shown as the last option; receives what the person typed. */
  onCreate?: (text: string) => void
  createLabel?: (text: string) => ReactNode
  /** Keeps typed text even when nothing is chosen (used for free-text line descriptions). */
  freeText?: { value: string; onChange: (text: string) => void }
  'aria-label'?: string
  'aria-describedby'?: string
}

/** Searchable select with optional "Add new…" row, keyboard support, and a list that never gets clipped. */
export function Combobox({ options, value, onChange, placeholder = 'Choose…', id, invalid, className, onCreate, createLabel, freeText, ...aria }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<CSSProperties>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const selected = options.find((o) => o.id === value)

  const filtered = useMemo(() => {
    const q = (freeText ? freeText.value : query).trim().toLowerCase()
    if (!q || (selected && !freeText && q === selected.label.toLowerCase())) return options
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q))
  }, [options, query, freeText, selected])
  const typed = (freeText ? freeText.value : query).trim()
  const showCreate = !!onCreate && !!typed && !options.some((o) => o.label.toLowerCase() === typed.toLowerCase())
  const total = filtered.length + (showCreate ? 1 : 0)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = inputRef.current?.getBoundingClientRect()
      if (!rect) return
      const below = window.innerHeight - rect.bottom
      const width = Math.max(rect.width, 260)
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
      setPosition(
        below < 300 && rect.top > below
          ? { bottom: window.innerHeight - rect.top + 4, left, width, maxHeight: Math.min(300, rect.top - 12) }
          : { top: rect.bottom + 4, left, width, maxHeight: Math.min(300, below - 12) },
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

  const choose = (index: number) => {
    if (index < filtered.length) {
      onChange(filtered[index].id)
      if (freeText) freeText.onChange(filtered[index].label)
    } else if (showCreate) onCreate!(typed)
    setOpen(false)
    setQuery('')
  }
  const move = (delta: number) => {
    const next = Math.max(0, Math.min(total - 1, active + delta))
    setActive(next)
    listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  let lastGroup: string | undefined
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
        value={freeText ? freeText.value : open ? query : (selected?.label ?? '')}
        placeholder={open && selected && !freeText ? selected.label : placeholder}
        onFocus={() => {
          setOpen(true)
          setActive(Math.max(0, filtered.findIndex((o) => o.id === value)))
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          if (freeText) {
            freeText.onChange(e.target.value)
            if (value) onChange('')
          } else setQuery(e.target.value)
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
          } else if (e.key === 'Enter' && open && total) {
            e.preventDefault()
            choose(active)
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation()
            setOpen(false)
          }
        }}
        className={cn(inputClass, 'pr-8 text-ellipsis')}
        {...aria}
      />
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
      {open && (total > 0 || !freeText) && (
        <div ref={listRef} id={listId} role="listbox" onMouseDown={(e) => e.preventDefault()} style={position} className="fixed z-[60] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop">
          {total === 0 && <p className="px-3 py-5 text-center text-sm text-fg-subtle">Nothing found</p>}
          {filtered.map((o, i) => {
            const header = o.group && o.group !== lastGroup ? o.group : null
            lastGroup = o.group
            return (
              <div key={o.id}>
                {header && <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">{header}</div>}
                <div
                  role="option"
                  aria-selected={o.id === value}
                  data-index={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(i)}
                  className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm', i === active && 'bg-surface-2')}
                >
                  <span className="min-w-0 flex-1 truncate text-fg">{o.label}</span>
                  {o.hint && <span className="shrink-0 text-xs text-fg-subtle tabular-nums">{o.hint}</span>}
                  {o.id === value && <Check className="size-4 shrink-0 text-primary-ink" />}
                </div>
              </div>
            )
          })}
          {showCreate && (
            <div
              role="option"
              aria-selected={false}
              data-index={filtered.length}
              onMouseEnter={() => setActive(filtered.length)}
              onClick={() => choose(filtered.length)}
              className={cn('mt-1 flex cursor-pointer items-center gap-2 rounded-lg border-t border-line px-2.5 py-2 text-sm font-medium text-primary-ink', active === filtered.length && 'bg-surface-2')}
            >
              <Plus className="size-4" />
              {createLabel ? createLabel(typed) : `Add "${typed}"`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
