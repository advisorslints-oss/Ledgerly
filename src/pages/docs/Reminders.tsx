import { useLiveQuery } from 'dexie-react-hooks'
import { BellRing, Check, Copy, Mail, MessageCircle, Settings2, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { DOC_TYPES } from '../../accounting/documents'
import { errorMessage } from '../../accounting/errors'
import { daysOverdue, dueReminders, logReminder, reminderSettings, renderReminder, stageLabel, undoReminder, type DueReminder } from '../../accounting/reminders'
import { Button, LinkButton } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { Field, Select, Textarea } from '../../components/ui/form'
import { Badge, Card, EmptyState, Spinner } from '../../components/ui/misc'
import { useToast } from '../../components/ui/toast'
import { db } from '../../db'
import type { Company, Contact, Doc, Reminder, ReminderTone } from '../../db/types'
import { toISODate } from '../../lib/dates'
import { useCompany, useFormat } from '../../state/company'
import { useContacts, useLedgerDocs } from '../../state/data'

/** Invoices that are due a payment reminder, most overdue first. */
export function useDueReminders(company: Company) {
  const { docs, settled } = useLedgerDocs(company.id)
  const reminders = useLiveQuery(() => db.reminders.where('companyId').equals(company.id).toArray(), [company.id])
  const settings = reminderSettings(company)
  const due = useMemo(() => (docs && settled && reminders ? dueReminders(docs, settled, reminders, settings) : undefined), [docs, settled, reminders, settings])
  return { due, reminders, docs, settled, settings }
}

const TONES: { value: ReminderTone; label: string; tone: 'primary' | 'warning' | 'danger' }[] = [
  { value: 'gentle', label: 'Friendly', tone: 'primary' },
  { value: 'firm', label: 'Firm', tone: 'warning' },
  { value: 'final', label: 'Final', tone: 'danger' },
]
const toneInfo = (t: ReminderTone) => TONES.find((x) => x.value === t)!
const CHANNEL: Record<Reminder['channel'], string> = { whatsapp: 'by WhatsApp', email: 'by email', copy: 'copied', manual: 'marked as sent' }

function ago(ms: number): string {
  const days = daysOverdue(toISODate(new Date(ms)))
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

export function Reminders() {
  const company = useCompany()
  const f = useFormat()
  const toast = useToast()
  const contacts = useContacts(company.id)
  const { due, reminders, docs, settings } = useDueReminders(company)
  const [open, setOpen] = useState<DueReminder | null>(null)

  const groups = useMemo(() => {
    if (!due || !contacts) return null
    const byContact = new Map<string, { contact?: Contact; items: DueReminder[] }>()
    for (const d of due) {
      const key = d.doc.contactId ?? ''
      if (!byContact.has(key)) byContact.set(key, { contact: contacts.find((c) => c.id === key), items: [] })
      byContact.get(key)!.items.push(d)
    }
    return [...byContact.values()]
  }, [due, contacts])

  if (!groups || !reminders || !docs) return <Spinner />

  const recent = [...reminders].sort((a, b) => b.sentAt - a.sentAt).slice(0, 8)
  const docById = new Map(docs.map((d) => [d.id, d]))

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm text-fg-muted">
          {settings.enabled
            ? `Unpaid invoices that are due a nudge: ${settings.stages
                .map((s) => stageLabel(s.days).toLowerCase())
                .join(', ')}. Each is sent from your own WhatsApp or email.`
            : 'Payment reminders are turned off.'}
        </p>
        <LinkButton to="/settings?tab=documents#reminders" icon={<Settings2 />} className="shrink-0">
          Reminder settings
        </LinkButton>
      </div>

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BellRing />}
            title={settings.enabled ? 'No reminders to send' : 'Reminders are off'}
            description={settings.enabled ? "You're all caught up. Invoices show up here when they're about to be due or overdue." : 'Turn them on in settings to see which customers to remind and when.'}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(({ contact, items }) => (
            <Card key={contact?.id ?? 'none'} className="overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
                <div className="min-w-0">
                  {contact ? (
                    <Link to={`/sales/customers/${contact.id}`} className="truncate text-[15px] font-semibold hover:text-primary-ink">
                      {contact.name}
                    </Link>
                  ) : (
                    <span className="text-[15px] font-semibold">No customer</span>
                  )}
                  <p className="text-xs text-fg-subtle">{[contact?.phone, contact?.email].filter(Boolean).join(' · ') || 'No phone or email saved'}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{f.money(items.reduce((s, x) => s + x.due, 0))}</span>
              </div>
              <ul className="divide-y divide-line">
                {items.map((item) => {
                  const t = toneInfo(item.stage.tone)
                  return (
                    <li key={item.doc.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm">
                          <Link to={`${DOC_TYPES.invoice.path}/${item.doc.id}`} className="font-medium hover:text-primary-ink">
                            {item.doc.number}
                          </Link>
                          <span className="tabular-nums">{f.money(item.due)}</span>
                          <Badge tone={t.tone}>{t.label}</Badge>
                        </p>
                        <p className={item.daysOverdue > 0 ? 'text-xs text-danger' : 'text-xs text-fg-subtle'}>
                          {item.daysOverdue > 0 ? `${item.daysOverdue} days overdue` : item.daysOverdue === 0 ? 'Due today' : `Due in ${-item.daysOverdue} days`} · {f.date(item.doc.dueDate!)}
                          {item.last && <span className="text-fg-subtle"> · last reminded {ago(item.last.sentAt)}</span>}
                        </p>
                      </div>
                      <Button size="sm" variant="primary" icon={<BellRing />} onClick={() => setOpen(item)} className="self-start sm:self-auto">
                        Send reminder
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <Card className="mt-6 overflow-hidden">
          <h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold">Recently sent</h2>
          <ul className="divide-y divide-line">
            {recent.map((r) => {
              const d = docById.get(r.documentId)
              return (
                <li key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {d ? (
                      <Link to={`${DOC_TYPES.invoice.path}/${d.id}`} className="font-medium hover:text-primary-ink">
                        {d.number}
                      </Link>
                    ) : (
                      'Removed invoice'
                    )}
                    <span className="text-fg-muted">
                      {' '}
                      {CHANNEL[r.channel]} {ago(r.sentAt)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Undo2 />}
                    onClick={async () => {
                      try {
                        await undoReminder(db, r.id)
                        toast('Reminder removed from the log')
                      } catch (err) {
                        toast(errorMessage(err), 'error')
                      }
                    }}
                  >
                    Undo
                  </Button>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {open && <ReminderDialog doc={open.doc} due={open.due} stageIndex={open.stageIndex} tone={open.stage.tone} daysOverdue={open.daysOverdue} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** Writes the reminder from a template, lets you edit it, then sends it from your own WhatsApp or email. */
export function ReminderDialog({ doc, due, stageIndex, tone: initialTone, daysOverdue, onClose }: { doc: Doc; due: number; stageIndex: number; tone: ReminderTone; daysOverdue: number; onClose: () => void }) {
  const company = useCompany()
  const f = useFormat()
  const toast = useToast()
  const contact = useLiveQuery(async () => (doc.contactId ? ((await db.contacts.get(doc.contactId)) ?? null) : null), [doc.contactId])
  const settings = reminderSettings(company)
  const [tone, setTone] = useState(initialTone)
  const [edited, setEdited] = useState<string | null>(null)

  const vars = {
    customer: contact?.contactPerson || contact?.name || 'there',
    number: doc.number,
    amount: f.money(due),
    dueDate: doc.dueDate ? f.date(doc.dueDate) : '',
    daysOverdue,
    business: company.name,
    paymentDetails: company.documentSettings?.bankDetails,
  }
  const text = edited ?? renderReminder(settings.templates[tone], vars)
  const subject = `Payment reminder: invoice ${doc.number} from ${company.name}`
  const phone = contact?.phone?.replace(/[^\d]/g, '')

  const send = async (channel: Reminder['channel']) => {
    if (channel === 'whatsapp') window.open(`https://wa.me/${phone ?? ''}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
    if (channel === 'email') window.location.href = `mailto:${contact?.email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`
    if (channel === 'copy') {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        return toast("Couldn't copy on this device", 'error')
      }
    }
    try {
      await logReminder(db, doc, Math.max(0, stageIndex), channel)
      toast(channel === 'copy' ? 'Message copied and reminder logged' : 'Reminder logged')
      onClose()
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`Remind ${contact?.name ?? 'customer'} about ${doc.number}`}
      description={`${f.money(due)} ${daysOverdue > 0 ? `· ${daysOverdue} days overdue` : daysOverdue === 0 ? '· due today' : `· due ${vars.dueDate}`}`}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center">
          <Button variant="ghost" icon={<Check />} onClick={() => send('manual')} className="sm:mr-auto">
            Mark as sent
          </Button>
          <Button icon={<Copy />} onClick={() => send('copy')}>
            Copy
          </Button>
          <Button icon={<Mail />} onClick={() => send('email')}>
            Email
          </Button>
          <Button variant="primary" icon={<MessageCircle />} onClick={() => send('whatsapp')}>
            WhatsApp
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Tone">
          {(id) => (
            <Select
              id={id}
              value={tone}
              onChange={(e) => {
                setTone(e.target.value as ReminderTone)
                setEdited(null)
              }}
            >
              {TONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Message" hint={!phone && !contact?.email ? 'Add a phone number or email to this customer to send it in one tap.' : 'Change anything you like before sending.'}>
          {(id, d) => <Textarea id={id} aria-describedby={d} value={text} onChange={(e) => setEdited(e.target.value)} rows={10} />}
        </Field>
      </div>
    </Dialog>
  )
}
