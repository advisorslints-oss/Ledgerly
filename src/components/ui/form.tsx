import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export const inputClass = cn(
  'w-full h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle',
  'transition-colors hover:border-fg-subtle/60 focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/20',
  'disabled:bg-surface-2 disabled:text-fg-subtle aria-invalid:border-danger aria-invalid:focus:ring-danger/20',
)

interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  className?: string
  children: (id: string, describedBy?: string) => ReactNode
}

/** Label + control + hint/error, wired up for screen readers. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId()
  const describedBy = error || hint ? `${id}-desc` : undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      {children(id, describedBy)}
      {(error || hint) && (
        <p id={describedBy} className={cn('text-xs', error ? 'text-danger' : 'text-fg-subtle')}>
          {error || hint}
        </p>
      )}
    </div>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputClass, 'h-auto min-h-20 py-2', className)} {...props} />
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(inputClass, 'select-chevron appearance-none pr-9', className)}
      {...props}
    >
      {children}
    </select>
  )
}

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
        </label>
        {description && <p className="mt-0.5 text-[13px] text-fg-subtle">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-surface-3 ring-1 ring-inset ring-line-strong',
        )}
      >
        <span
          className={cn(
            'inline-block size-5 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}
