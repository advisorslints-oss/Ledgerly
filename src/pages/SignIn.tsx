import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, CloudCog, Eye, EyeOff, Laptop, RefreshCw, Smartphone, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Logo } from '../components/layout/AppShell'
import { Button } from '../components/ui/button'
import { Field, Input } from '../components/ui/form'
import { Segmented } from '../components/ui/misc'
import { db } from '../db'
import { readMeta } from '../sync/engine'
import { signIn, signUp } from '../sync/controller'

const PERKS = [
  { icon: Laptop, text: 'The same books on your computer, phone and tablet' },
  { icon: RefreshCw, text: 'Work offline; changes sync when you reconnect' },
  { icon: Users, text: 'Invite your accountant or team with the right access' },
  { icon: Smartphone, text: 'Lost a device? Sign in on a new one and carry on' },
]

export function SignIn() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const companies = useLiveQuery(() => db.companies.toArray(), [])
  const [mode, setMode] = useState<'signin' | 'signup'>(params.get('mode') === 'signup' ? 'signup' : 'signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [server, setServer] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (mode === 'signup' && password.length < 8) return setError('Use a password of at least 8 characters.')
    setBusy(true)
    try {
      if (mode === 'signup') await signUp(server, name, email, password)
      else await signIn(server, email, password)
      const meta = await readMeta(db)
      const local = await db.companies.toArray()
      const unsynced = local.filter((c) => !meta.synced.includes(c.id))
      navigate(unsynced.length ? '/settings?tab=account&choose=1' : local.length ? '/' : '/welcome', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -top-24 -right-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <Logo className="size-10 ring-1 ring-white/20" />
          <span className="text-xl font-semibold tracking-tight">Ledgerly</span>
        </div>
        <div className="relative my-auto max-w-md">
          <h2 className="text-4xl leading-tight font-semibold tracking-tight">Your books, on every device.</h2>
          <ul className="mt-10 space-y-5">
            {PERKS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon className="size-5" />
                </span>
                <span className="text-indigo-50">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex min-h-dvh flex-col px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-10 lg:px-16">
        <div className="flex items-center justify-between">
          <Link to={companies?.length ? '/' : '/welcome'} className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> Back
          </Link>
          <div className="flex items-center gap-2 lg:hidden">
            <Logo className="size-7" />
            <span className="font-semibold">Ledgerly</span>
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <h1 className="text-3xl font-semibold tracking-tight">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mt-2 text-fg-muted">{mode === 'signup' ? 'Free. Your books sync across all your devices.' : 'Sign in to sync your books on this device.'}</p>
          <Segmented
            label="Account"
            value={mode}
            onChange={(m) => (setMode(m), setError(null))}
            className="mt-6 w-full [&>button]:flex-1"
            options={[
              { value: 'signin', label: 'Sign in' },
              { value: 'signup', label: 'Create account' },
            ]}
          />
          <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
            {mode === 'signup' && <Field label="Your name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} className="h-11" />}</Field>}
            <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className="h-11" />}</Field>
            <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
              {(id, d) => (
                <div className="relative">
                  <Input
                    id={id}
                    aria-describedby={d}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    required
                    className="h-11 pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-fg-subtle hover:text-fg"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              )}
            </Field>
            {advanced ? (
              <Field label="Sync server" hint="Leave empty to use this website. Enter an address if your team runs its own Ledgerly server.">
                {(id, d) => <Input id={id} aria-describedby={d} value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://books.example.com" inputMode="url" />}
              </Field>
            ) : (
              <button type="button" onClick={() => setAdvanced(true)} className="inline-flex items-center gap-1.5 self-start text-xs text-fg-subtle hover:text-fg">
                <CloudCog className="size-3.5" /> Advanced: choose a sync server
              </button>
            )}
            {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            <Button variant="primary" size="lg" type="submit" disabled={busy}>
              {busy ? (mode === 'signup' ? 'Creating account…' : 'Signing in and syncing…') : mode === 'signup' ? 'Create account' : 'Sign in'}
            </Button>
          </form>
          <p className="mt-6 text-center text-xs text-fg-subtle">You can keep using Ledgerly without an account. Everything still works offline on this device.</p>
        </div>
      </main>
    </div>
  )
}
