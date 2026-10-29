import { STATE_LABELS } from '../accounting/documents'
import { Badge } from './ui/misc'

export function StateBadge({ state }: { state: string }) {
  const info = STATE_LABELS[state] ?? { label: state, tone: 'neutral' as const }
  return <Badge tone={info.tone}>{info.label}</Badge>
}
