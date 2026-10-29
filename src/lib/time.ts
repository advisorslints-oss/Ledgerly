/** "just now", "5 min ago", "3 h ago", or a date for anything older than a day. */
export function relativeTime(ts: number, locale: string): string {
  const diff = Date.now() - ts
  if (diff < 45_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`
  return new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}
