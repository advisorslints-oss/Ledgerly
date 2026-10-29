import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' }

/** Native <dialog> as a centred modal on desktop and a bottom sheet on phones. */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      el.showModal()
      // showModal focuses the first focusable element (the close button); move focus to the form instead.
      el.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]):not([disabled]), select, textarea')?.focus()
    }
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={cn(
        'm-0 mt-auto w-full max-w-none rounded-t-2xl border border-line bg-surface p-0 shadow-pop',
        'sm:m-auto sm:rounded-2xl',
        'max-h-[92dvh]',
        widths[size],
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3 sm:px-6">
            <div>
              <h2 className="text-lg font-semibold text-fg">{title}</h2>
              {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-4" />
            </button>
          </div>
          {children && <div className="min-h-0 overflow-y-auto px-5 pb-5 sm:px-6">{children}</div>}
          {footer && (
            <div className="flex flex-col-reverse gap-2 border-t border-line bg-surface-2/60 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-6 sm:pb-4">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  )
}

interface ConfirmProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: ReactNode
  description: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  children?: ReactNode
  confirmDisabled?: boolean
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, danger, busy, children, confirmDisabled }: ConfirmProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            className={cn(
              'h-10 rounded-lg px-4 text-sm font-medium disabled:opacity-50',
              danger ? 'bg-danger text-white hover:opacity-90' : 'bg-primary text-on-primary hover:bg-primary-hover',
            )}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}
