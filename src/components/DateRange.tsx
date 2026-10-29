import { useSearchParams } from 'react-router'
import { presetRange, RANGE_PRESETS, type DateRange, type RangePreset } from '../lib/dates'
import { useCompany } from '../state/company'
import { Input, Select } from './ui/form'

/** Date range kept in the URL (?preset=&from=&to=) so reports can be bookmarked and drilled into. */
export function useDateRange(defaultPreset: RangePreset = 'this_fy'): [DateRange & { preset: RangePreset }, (next: Partial<DateRange> & { preset?: RangePreset }) => void] {
  const company = useCompany()
  const [params, setParams] = useSearchParams()
  const preset = (params.get('preset') as RangePreset) || (params.get('from') ? 'custom' : defaultPreset)
  const base = preset === 'custom' ? presetRange('this_month', company.fiscalYearStartMonth) : presetRange(preset, company.fiscalYearStartMonth)
  const range = {
    preset,
    from: params.get('from') || base.from,
    to: params.get('to') || base.to,
  }
  const set = (next: Partial<DateRange> & { preset?: RangePreset }) => {
    const p = new URLSearchParams(params)
    if (next.preset && next.preset !== 'custom') {
      p.set('preset', next.preset)
      p.delete('from')
      p.delete('to')
    } else {
      p.set('preset', 'custom')
      p.set('from', next.from ?? range.from)
      p.set('to', next.to ?? range.to)
    }
    setParams(p, { replace: true })
  }
  return [range, set]
}

export function DateRangeControl({ range, onChange }: { range: DateRange & { preset: RangePreset }; onChange: (next: Partial<DateRange> & { preset?: RangePreset }) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Period" value={range.preset} onChange={(e) => onChange({ preset: e.target.value as RangePreset })} className="w-auto min-w-44">
        {RANGE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </Select>
      <div className="flex items-center gap-2">
        <Input type="date" aria-label="From" value={range.from} max={range.to} onChange={(e) => e.target.value && onChange({ from: e.target.value })} className="w-auto" />
        <span className="text-sm text-fg-subtle">to</span>
        <Input type="date" aria-label="To" value={range.to} min={range.from} onChange={(e) => e.target.value && onChange({ to: e.target.value })} className="w-auto" />
      </div>
    </div>
  )
}
