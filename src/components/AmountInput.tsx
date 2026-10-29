import { useEffect, useState, type InputHTMLAttributes } from 'react'
import { cn } from '../lib/cn'
import { useFormat } from '../state/company'
import { inputClass } from './ui/form'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: number
  onChange: (minor: number) => void
  allowNegative?: boolean
}

/** Text input for money that keeps an exact minor-unit value and tolerates "1,234.50" style typing. */
export function AmountInput({ value, onChange, allowNegative, className, ...rest }: Props) {
  const f = useFormat()
  const [text, setText] = useState(() => f.toInput(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(f.toInput(value))
  }, [value, focused, f])

  const parsed = text.trim() ? f.parse(text) : 0
  const invalid = parsed === null || (!allowNegative && parsed < 0)

  return (
    <input
      inputMode="decimal"
      autoComplete="off"
      placeholder={f.toInput(0) || (f.digits ? `0.${'0'.repeat(f.digits)}` : '0')}
      value={text}
      aria-invalid={invalid || undefined}
      onFocus={(e) => {
        setFocused(true)
        e.target.select()
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value)
        const p = e.target.value.trim() ? f.parse(e.target.value) : 0
        if (p !== null && (allowNegative || p >= 0)) onChange(p)
        else onChange(0)
      }}
      className={cn(inputClass, 'text-right tabular-nums', className)}
      {...rest}
    />
  )
}
