import { useSyncExternalStore } from 'react'

export type Theme = 'system' | 'light' | 'dark'
/** Simple mode hides accounting jargon (journals, trial balance, account codes) for non-accountants. */
export type Mode = 'simple' | 'accountant'

export interface Prefs {
  theme: Theme
  mode: Mode
  companyId?: string
  dismissedChecklist?: string[]
}

const KEY = 'ledgerly.prefs'
const listeners = new Set<() => void>()

function load(): Prefs {
  try {
    return { theme: 'system', mode: 'simple', ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { theme: 'system', mode: 'simple' }
  }
}

let prefs: Prefs = load()

export function getPrefs(): Prefs {
  return prefs
}

export function setPrefs(patch: Partial<Prefs>): void {
  prefs = { ...prefs, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Storage can be unavailable in private windows; prefs still apply for this session.
  }
  applyTheme()
  listeners.forEach((l) => l())
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => prefs,
  )
}

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

export function applyTheme(): void {
  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && !!media?.matches)
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0d12' : '#f5f6fa')
}

media?.addEventListener('change', () => {
  if (prefs.theme === 'system') applyTheme()
})
