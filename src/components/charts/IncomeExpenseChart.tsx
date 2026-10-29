import { useEffect, useRef, useState } from 'react'
import type { MonthPoint } from '../../accounting/reports'
import { cn } from '../../lib/cn'
import { monthLabel } from '../../lib/dates'
import { useCompany, useFormat } from '../../state/company'
import { Segmented } from '../ui/misc'

const HEIGHT = 240
const M = { top: 12, right: 4, bottom: 28, left: 52 }

function niceMax(value: number): number {
  if (value <= 0) return 1
  const exp = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (step * exp >= value) return step * exp
  return 10 * exp
}

/** Column with a 4px rounded data end and a square foot on the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return ''
  const r = Math.min(4, h, w / 2)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

export function IncomeExpenseChart({ data }: { data: MonthPoint[] }) {
  const company = useCompany()
  const f = useFormat()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number | null>(null)
  const [view, setView] = useState<'chart' | 'table'>('chart')

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [view])

  const max = niceMax(Math.max(...data.flatMap((d) => [d.income, d.expenses]), 0))
  const innerW = Math.max(0, width - M.left - M.right)
  const innerH = HEIGHT - M.top - M.bottom
  const band = data.length ? innerW / data.length : 0
  const barW = Math.max(4, Math.min(24, (band * 0.62 - 2) / 2))
  const y = (v: number) => M.top + innerH - (Math.max(0, v) / max) * innerH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max)
  const empty = data.every((d) => d.income === 0 && d.expenses === 0)

  const legend = (
    <div className="flex items-center gap-4 text-xs text-fg-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-series-1" /> Income
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-series-2" /> Expenses
      </span>
    </div>
  )

  const point = active !== null ? data[active] : null

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {legend}
        <Segmented
          label="Display as"
          value={view}
          onChange={setView}
          options={[
            { value: 'chart', label: 'Chart' },
            { value: 'table', label: 'Table' },
          ]}
        />
      </div>

      {view === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-fg-subtle">
                <th className="py-2 font-medium">Month</th>
                <th className="py-2 text-right font-medium">Income</th>
                <th className="py-2 text-right font-medium">Expenses</th>
                <th className="py-2 text-right font-medium">Profit</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.map((d) => (
                <tr key={d.month} className="border-b border-line last:border-0">
                  <td className="py-2 text-fg-muted">{monthLabel(d.month, company.locale)} {d.month.slice(0, 4)}</td>
                  <td className="py-2 text-right">{f.money(d.income)}</td>
                  <td className="py-2 text-right">{f.money(d.expenses)}</td>
                  <td className={cn('py-2 text-right font-medium', d.profit < 0 && 'text-danger')}>{f.money(d.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrapRef} className="relative select-none" onPointerLeave={() => setActive(null)}>
          {width > 0 && (
            <svg width={width} height={HEIGHT} role="img" aria-label="Income and expenses by month. Switch to the table view for exact figures.">
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} shapeRendering="crispEdges" />
                  {!empty && (
                    <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-fg-subtle text-[11px] tabular-nums">
                      {f.money(t, { compact: true })}
                    </text>
                  )}
                </g>
              ))}
              {data.map((d, i) => {
                const cx = M.left + band * i + band / 2
                const left = cx - barW - 1
                return (
                  <g key={d.month}>
                    {active === i && <rect x={M.left + band * i + 2} y={M.top} width={band - 4} height={innerH} rx={6} className="fill-surface-2" />}
                    <path d={columnPath(left, y(d.income), barW, y(0) - y(d.income))} fill="var(--series-1)" />
                    <path d={columnPath(cx + 1, y(d.expenses), barW, y(0) - y(d.expenses))} fill="var(--series-2)" />
                    <text x={cx} y={HEIGHT - 8} textAnchor="middle" className={cn('text-[11px]', active === i ? 'fill-fg' : 'fill-fg-subtle')}>
                      {monthLabel(d.month, company.locale)}
                    </text>
                    <rect
                      x={M.left + band * i}
                      y={0}
                      width={band}
                      height={HEIGHT}
                      fill="transparent"
                      onPointerEnter={() => setActive(i)}
                      onPointerDown={() => setActive(i)}
                    />
                  </g>
                )
              })}
            </svg>
          )}
          {empty && (
            <p className="pointer-events-none absolute inset-0 grid place-items-center pb-8 text-sm text-fg-subtle">
              Income and expenses will appear here as you record them.
            </p>
          )}
          {point && active !== null && !empty && (
            <div
              className="pointer-events-none absolute top-2 z-10 w-48 rounded-xl border border-line bg-surface p-3 text-xs shadow-pop"
              style={{
                left: Math.min(Math.max(0, M.left + band * active + band / 2 - 96), Math.max(0, width - 192)),
              }}
            >
              <p className="mb-2 font-semibold text-fg">
                {monthLabel(point.month, company.locale)} {point.month.slice(0, 4)}
              </p>
              <p className="flex items-center justify-between gap-3 text-fg-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-[2px] bg-series-1" /> Income
                </span>
                <span className="font-medium text-fg tabular-nums">{f.money(point.income)}</span>
              </p>
              <p className="mt-1 flex items-center justify-between gap-3 text-fg-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-[2px] bg-series-2" /> Expenses
                </span>
                <span className="font-medium text-fg tabular-nums">{f.money(point.expenses)}</span>
              </p>
              <p className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-2 text-fg-muted">
                Profit
                <span className={cn('font-semibold tabular-nums', point.profit < 0 ? 'text-danger' : 'text-fg')}>{f.money(point.profit)}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
