import { ArrowLeft, Download, Printer } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { ReportRow, ReportSection } from '../../accounting/reports'
import { Button } from '../../components/ui/button'
import { Card, PageHeader } from '../../components/ui/misc'
import { cn } from '../../lib/cn'
import { downloadFile, toCSV } from '../../lib/platform'
import { useCompany, useFormat } from '../../state/company'
import { usePrefs } from '../../state/prefs'

export function ReportPage({
  title,
  description,
  period,
  controls,
  csv,
  children,
}: {
  title: string
  description: string
  period: string
  controls: ReactNode
  csv: () => (string | number)[][]
  children: ReactNode
}) {
  const company = useCompany()
  return (
    <div>
      <PageHeader
        back={
          <Link to="/reports" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> Reports
          </Link>
        }
        title={title}
        description={description}
        actions={
          <>
            <Button icon={<Download />} onClick={() => downloadFile(`${company.name} - ${title} - ${period}.csv`, toCSV(csv()), 'text/csv')}>
              CSV
            </Button>
            <Button icon={<Printer />} onClick={() => window.print()}>
              Print / PDF
            </Button>
          </>
        }
      />
      <div className="no-print mb-4">{controls}</div>
      <Card className="overflow-hidden">
        <div className="border-b border-line px-5 py-5 text-center sm:px-8">
          <p className="text-sm font-semibold text-fg">{company.legalName || company.name}</p>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-fg-subtle">{period}</p>
        </div>
        <div className="px-2 py-3 sm:px-4">{children}</div>
      </Card>
    </div>
  )
}

export function SectionRows({ section, linkQuery, emptyText }: { section: ReportSection; linkQuery: string; emptyText?: string }) {
  const f = useFormat()
  const { mode } = usePrefs()
  return (
    <div className="mb-2">
      <h3 className="px-3 pt-3 pb-1.5 text-xs font-semibold tracking-wider text-fg-subtle uppercase">{section.title}</h3>
      {section.rows.length === 0 && <p className="px-3 py-1.5 text-sm text-fg-subtle">{emptyText ?? 'Nothing in this period'}</p>}
      {section.rows.map((row) => (
        <Row key={row.id} row={row} linkQuery={linkQuery} showCode={mode === 'accountant'} money={f.money} />
      ))}
      <TotalRow label={`Total ${section.title.toLowerCase()}`} amount={section.total} />
    </div>
  )
}

function Row({ row, linkQuery, showCode, money }: { row: ReportRow; linkQuery: string; showCode: boolean; money: (n: number) => string }) {
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate">
        {showCode && row.code && <span className="mr-2 text-xs text-fg-subtle tabular-nums">{row.code}</span>}
        {row.label}
      </span>
      <span className={cn('tabular-nums', row.amount < 0 && 'text-danger')}>{money(row.amount)}</span>
    </>
  )
  return row.account ? (
    <Link to={`/accounts/${row.account.id}?${linkQuery}`} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg hover:bg-surface-2">
      {content}
    </Link>
  ) : (
    <div className="flex items-center gap-3 px-3 py-2 text-sm text-fg-muted italic">{content}</div>
  )
}

export function TotalRow({ label, amount, strong }: { label: string; amount: number; strong?: boolean }) {
  const f = useFormat()
  return (
    <div
      className={cn(
        'mx-3 flex items-center gap-3 border-t py-2.5 text-sm font-semibold',
        strong ? 'mt-3 border-t-2 border-fg/70 text-base' : 'border-line',
      )}
    >
      <span className="flex-1">{label}</span>
      <span className={cn('tabular-nums', amount < 0 && 'text-danger')}>{f.money(amount)}</span>
    </div>
  )
}

export function sectionCsv(section: ReportSection, toInput: (n: number) => string): (string | number)[][] {
  return [[section.title, ''], ...section.rows.map((r) => [r.code ? `${r.code} ${r.label}` : r.label, toInput(r.amount) || '0']), [`Total ${section.title.toLowerCase()}`, toInput(section.total) || '0'], ['', '']]
}
