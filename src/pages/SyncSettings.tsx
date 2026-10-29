import { useLiveQuery } from 'dexie-react-hooks'
import { Cloud, CloudDownload, CloudUpload, LogOut, MoreHorizontal, RefreshCw, Trash2, UserPlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { errorMessage } from '../accounting/errors'
import { Button, LinkButton } from '../components/ui/button'
import { ConfirmDialog, Dialog } from '../components/ui/dialog'
import { Field, Input, Select } from '../components/ui/form'
import { Menu, MenuItem } from '../components/ui/menu'
import { Badge, Card, CardHeader, Spinner } from '../components/ui/misc'
import { useToast } from '../components/ui/toast'
import { db } from '../db'
import type { Company } from '../db/types'
import { cn } from '../lib/cn'
import { relativeTime } from '../lib/time'
import { useCompany } from '../state/company'
import { setPrefs } from '../state/prefs'
import { deleteEverywhere, dismissIssue, downloadToDevice, removeFromDevice, signOut, startSyncing, syncNow, team, useSyncState } from '../sync/controller'
import type { Member, Role } from '../sync/protocol'

const ROLE_LABELS: Record<Role, string> = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' }

export function AccountTab() {
  const s = useSyncState()
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const companies = useLiveQuery(() => db.companies.toArray(), [])
  const pending = useLiveQuery(() => db.changes.count(), [])
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'delete' | 'signout'; company?: Company } | null>(null)

  if (!s.ready || !companies) return <Spinner />
  const session = s.meta.session

  if (!session) {
    return (
      <Card className="overflow-hidden">
        <div className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary-ink">
            <Cloud className="size-6" />
          </span>
          <div className="flex-1">
            <h2 className="text-base font-semibold">Sync your books across devices</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Sign in to keep the same books on your computer, phone and tablet, and to invite your team. Without an account everything still works on this device.
            </p>
            {s.error && <p className="mt-2 text-sm text-warning">{s.error}</p>}
          </div>
          <div className="flex gap-2">
            <LinkButton to="/sign-in?mode=signup">Create account</LinkButton>
            <LinkButton to="/sign-in" variant="primary">
              Sign in
            </LinkButton>
          </div>
        </div>
      </Card>
    )
  }

  const synced = new Set(s.meta.synced)
  const local = new Map(companies.map((c) => [c.id, c]))
  const remoteOnly = s.meta.access.filter((a) => !local.has(a.id))
  const unsynced = companies.filter((c) => !synced.has(c.id))
  const statusText =
    s.status === 'syncing' ? 'Syncing…' : s.status === 'offline' ? 'Offline. Changes will sync when you reconnect.' : s.status === 'error' ? (s.error ?? 'Sync problem') : s.meta.lastSyncedAt ? `Synced ${relativeTime(s.meta.lastSyncedAt, 'en')}` : 'Not synced yet'

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn()
      toast(message)
    } catch (err) {
      toast(errorMessage(err).replace(/^Something went wrong: /, ''), 'error')
    }
  }

  return (
    <>
      <Card className="mb-5">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-lg font-semibold text-on-primary">{session.user.name.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{session.user.name}</p>
            <p className="truncate text-sm text-fg-muted">
              {session.user.email}
              {session.server && <span className="text-fg-subtle"> · {session.server}</span>}
            </p>
          </div>
          <Button icon={<LogOut />} onClick={() => setConfirm({ kind: 'signout' })}>
            Sign out
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3 text-sm">
          <RefreshCw className={cn('size-4 text-fg-subtle', s.status === 'syncing' && 'animate-spin')} />
          <span className={cn('flex-1', s.status === 'error' ? 'text-danger' : 'text-fg-muted')}>
            {statusText}
            {pending ? ` · ${pending} change${pending > 1 ? 's' : ''} waiting` : ''}
          </span>
          <Button size="sm" onClick={() => void syncNow()} disabled={s.status === 'syncing'}>
            Sync now
          </Button>
        </div>
      </Card>

      <Card className="mb-5">
        <CardHeader title="Businesses" description="Choose which businesses sync with your account on this device." />
        <ul className="divide-y divide-line border-t border-line">
          {companies.map((c) => {
            const isSynced = synced.has(c.id)
            const role = s.meta.roles[c.id]
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {c.name}
                    {isSynced ? <Badge tone="success">Syncing</Badge> : <Badge>Only on this device</Badge>}
                    {isSynced && role && role !== 'owner' && <Badge tone="primary">{ROLE_LABELS[role]}</Badge>}
                  </p>
                </div>
                {s.busy === c.id ? (
                  <span className="inline-flex items-center gap-2 text-sm text-fg-subtle">
                    <Spinner className="size-4" /> Working…
                  </span>
                ) : isSynced ? (
                  <Menu
                    align="end"
                    trigger={({ toggle }) => (
                      <Button size="icon" variant="ghost" onClick={toggle} aria-label={`Options for ${c.name}`}>
                        <MoreHorizontal />
                      </Button>
                    )}
                  >
                    {(close) => (
                      <>
                        <MenuItem icon={<X />} onClick={() => (close(), setConfirm({ kind: 'remove', company: c }))}>
                          Remove from this device
                        </MenuItem>
                        {role === 'owner' && (
                          <MenuItem danger icon={<Trash2 />} onClick={() => (close(), setConfirm({ kind: 'delete', company: c }))}>
                            Delete everywhere
                          </MenuItem>
                        )}
                      </>
                    )}
                  </Menu>
                ) : (
                  <Button size="sm" variant="soft" icon={<CloudUpload />} onClick={() => void run(() => startSyncing(c.id), `${c.name} now syncs with your account`)}>
                    Start syncing
                  </Button>
                )}
              </li>
            )
          })}
          {remoteOnly.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {a.name} <Badge>In your account</Badge>
                  {a.role !== 'owner' && <Badge tone="primary">{ROLE_LABELS[a.role]}</Badge>}
                </p>
              </div>
              {s.busy === a.id ? (
                <span className="inline-flex items-center gap-2 text-sm text-fg-subtle">
                  <Spinner className="size-4" /> Downloading…
                </span>
              ) : (
                <Button size="sm" variant="soft" icon={<CloudDownload />} onClick={() => void run(() => downloadToDevice(a.id), `${a.name} downloaded`)}>
                  Download
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {s.meta.issues.length > 0 && (
        <Card className="mb-5">
          <CardHeader title="Changes that couldn't sync" description="These were made on this device but conflicted with changes from another device, so the other version was kept." />
          <ul className="divide-y divide-line border-t border-line">
            {s.meta.issues.map((i) => (
              <li key={i.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {i.summary} <span className="font-normal text-fg-subtle">· {local.get(i.companyId)?.name ?? ''} · {relativeTime(i.at, 'en')}</span>
                  </p>
                  <p className="text-fg-muted">{i.reason}</p>
                </div>
                <Button size="icon" variant="ghost" aria-label="Dismiss" onClick={() => void dismissIssue(i.id)}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ChooseDialog open={params.get('choose') === '1' && unsynced.length > 0} companies={unsynced} onClose={() => setParams({ tab: 'account' }, { replace: true })} />

      <ConfirmDialog
        open={confirm?.kind === 'remove'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm!.company!
          setConfirm(null)
          void run(async () => {
            await removeFromDevice(c.id)
            setPrefs({ companyId: undefined })
          }, `${c.name} was removed from this device`)
        }}
        title={`Remove ${confirm?.company?.name} from this device?`}
        description="It stays in your account and on your other devices. You can download it again any time."
        confirmLabel="Remove from device"
      />
      <ConfirmDialog
        open={confirm?.kind === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm!.company!
          setConfirm(null)
          void run(async () => {
            await deleteEverywhere(c.id)
            setPrefs({ companyId: undefined })
            navigate('/')
          }, `${c.name} was deleted`)
        }}
        danger
        title={`Delete ${confirm?.company?.name} everywhere?`}
        description="This permanently deletes the business from your account and every device, for everyone with access. Download a backup first if you might need it."
        confirmLabel="Delete everywhere"
      />
      <SignOutDialog open={confirm?.kind === 'signout'} onClose={() => setConfirm(null)} pending={pending ?? 0} />
    </>
  )
}

function SignOutDialog({ open, onClose, pending }: { open: boolean; onClose: () => void; pending: number }) {
  const toast = useToast()
  const [remove, setRemove] = useState(false)
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Sign out?"
      description={pending ? `${pending} change${pending > 1 ? 's' : ''} haven't synced yet and will stay only on this device.` : 'Your books stay on your account and other devices.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              onClose()
              await signOut({ removeSynced: remove })
              if (remove) setPrefs({ companyId: undefined })
              toast('Signed out')
            }}
          >
            Sign out
          </Button>
        </>
      }
    >
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
        <span>
          Also remove synced businesses from this device
          <span className="block text-xs text-fg-subtle">Choose this on a shared or borrowed computer.</span>
        </span>
      </label>
    </Dialog>
  )
}

/** After signing in: pick which of this device's businesses to add to the account. */
function ChooseDialog({ open, companies, onClose }: { open: boolean; companies: Company[]; onClose: () => void }) {
  const toast = useToast()
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setChosen(new Set(companies.filter((c) => !c.isDemo).map((c) => c.id)))
    // Pre-select real businesses each time the dialog opens.
  }, [open])
  const toggle = (id: string) => setChosen((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])))

  const go = async () => {
    setBusy(true)
    try {
      for (const id of chosen) await startSyncing(id)
      toast(chosen.size ? 'Your businesses now sync with your account' : 'Nothing will be uploaded')
      onClose()
    } catch (err) {
      toast(errorMessage(err).replace(/^Something went wrong: /, ''), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Sync your businesses?"
      description="These are on this device but not in your account yet. Synced businesses appear on all your devices."
      footer={
        <>
          <Button onClick={onClose}>Not now</Button>
          <Button variant="primary" onClick={go} disabled={busy}>
            {busy ? 'Uploading…' : `Sync ${chosen.size || ''} selected`}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-2">
        {companies.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-4 py-3 hover:bg-surface-2">
              <input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggle(c.id)} className="size-4 accent-[var(--primary)]" />
              <span className="flex-1 text-sm font-medium">{c.name}</span>
              {c.isDemo && <Badge>Demo</Badge>}
            </label>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}

export function TeamTab() {
  const company = useCompany()
  const s = useSyncState()
  const toast = useToast()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const [error, setError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const synced = !!s.meta.session && s.meta.synced.includes(company.id)
  const myRole = s.meta.roles[company.id]

  useEffect(() => {
    if (!synced) return
    team.list(company.id).then(setMembers, (err) => setError(errorMessage(err)))
  }, [synced, company.id])

  if (!synced) {
    return (
      <Card className="p-6">
        <h2 className="text-base font-semibold">Work on these books together</h2>
        <p className="mt-1 text-sm text-fg-muted">
          {s.meta.session ? `Start syncing ${company.name} to invite your accountant or team.` : 'Sign in and sync this business to invite your accountant or team.'}
        </p>
        <LinkButton to={s.meta.session ? '/settings?tab=account' : '/sign-in'} variant="primary" className="mt-4">
          {s.meta.session ? 'Go to Account & sync' : 'Sign in'}
        </LinkButton>
      </Card>
    )
  }

  const act = async (fn: () => Promise<Member[] | void>, message: string) => {
    setError(null)
    try {
      const next = await fn()
      if (next) setMembers(next)
      toast(message)
    } catch (err) {
      setError(errorMessage(err).replace(/^Something went wrong: /, ''))
    }
  }

  return (
    <>
      <Card className="mb-5">
        <CardHeader title="People with access" description="Owners can do everything. Editors can add and change records. Viewers can only look." />
        {!members ? (
          <div className="px-5 pb-5">
            <Spinner />
          </div>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary-ink">{m.name.slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {m.name}
                    {m.userId === s.meta.session?.user.id && <span className="font-normal text-fg-subtle"> (you)</span>}
                  </p>
                  <p className="truncate text-xs text-fg-subtle">{m.email}</p>
                </div>
                {myRole === 'owner' && m.role !== 'owner' ? (
                  <>
                    <Select aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => void act(() => team.setRole(company.id, m.userId, e.target.value as 'editor' | 'viewer'), 'Access updated')} className="h-9 w-auto">
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </Select>
                    <Button size="icon" variant="ghost" aria-label={`Remove ${m.name}`} onClick={() => void act(async () => (await team.remove(company.id, m.userId), team.list(company.id)), `${m.name} no longer has access`)}>
                      <X />
                    </Button>
                  </>
                ) : (
                  <Badge tone={m.role === 'owner' ? 'primary' : 'neutral'}>{ROLE_LABELS[m.role]}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {myRole === 'owner' ? (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Invite someone</h2>
          <p className="mt-0.5 text-[13px] text-fg-subtle">They need a Ledgerly account with this email. The business appears on their devices next time they sync.</p>
          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault()
              void act(async () => {
                const next = await team.invite(company.id, email, role)
                setEmail('')
                return next
              }, 'Invitation sent')
            }}
          >
            <Field label="Email" className="flex-1">
              {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="accountant@example.com" />}
            </Field>
            <Field label="Access" className="sm:w-40">
              {(id) => (
                <Select id={id} value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </Select>
              )}
            </Field>
            <Button variant="primary" type="submit" icon={<UserPlus />}>
              Invite
            </Button>
          </form>
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        </Card>
      ) : (
        <Card className="flex flex-wrap items-center gap-3 p-5">
          <p className="flex-1 text-sm text-fg-muted">You have {ROLE_LABELS[myRole ?? 'viewer'].toLowerCase()} access to {company.name}.</p>
          <Button onClick={() => setLeaving(true)}>Leave this business</Button>
          {error && <p className="w-full text-sm text-danger">{error}</p>}
        </Card>
      )}
      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        onConfirm={async () => {
          setLeaving(false)
          try {
            await team.remove(company.id, s.meta.session!.user.id)
            await removeFromDevice(company.id)
            setPrefs({ companyId: undefined })
            toast(`You left ${company.name}`)
          } catch (err) {
            setError(errorMessage(err))
          }
        }}
        title={`Leave ${company.name}?`}
        description="You'll lose access, and it will be removed from this device. The owner can invite you again."
        confirmLabel="Leave"
      />
      <p className="mt-4 text-xs text-fg-subtle">
        Changes made by others appear after the next sync. <Link to="/settings?tab=account" className="underline-offset-2 hover:underline">Sync settings</Link>
      </p>
    </>
  )
}
