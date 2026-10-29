import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

type ToastTone = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: ReactNode
  tone: ToastTone
}

const ToastContext = createContext<(message: ReactNode, tone?: ToastTone) => void>(() => {})

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), [])
  const show = useCallback(
    (message: ReactNode, tone: ToastTone = 'success') => {
      const id = nextId++
      setItems((list) => [...list.slice(-2), { id, message, tone }])
      setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 3500)
    },
    [dismiss],
  )
  const value = useMemo(() => show, [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[100] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:px-6"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="animate-toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-fg shadow-pop"
          >
            {t.tone === 'error' ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
            ) : (
              <CircleCheck className={cn('mt-0.5 size-4 shrink-0', t.tone === 'success' ? 'text-success' : 'text-primary-ink')} />
            )}
            <div className="min-w-0 flex-1">{t.message}</div>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-fg-subtle hover:text-fg">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
