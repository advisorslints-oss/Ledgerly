import { ArrowLeft, ArrowRight, BookCheck, Check, CloudOff, Laptop, Lock, Smartphone, Sparkles } from 'lucide-react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { createCompany } from '../accounting/company'
import { COUNTRIES, detectCountry, getCountry } from '../accounting/countries'
import { createDemoCompany } from '../accounting/demo'
import { errorMessage } from '../accounting/errors'
import { buildChart, getIndustry, INDUSTRIES } from '../accounting/templates'
import { Logo } from '../components/layout/AppShell'
import { Button } from '../components/ui/button'
import { Field, Input, Select, Switch } from '../components/ui/form'
import { useToast } from '../components/ui/toast'
import { db } from '../db'
import type { Company, Features, IndustryId } from '../db/types'
import { cn } from '../lib/cn'
import { MONTHS } from '../lib/dates'
import { CURRENCIES } from '../lib/money'
import { getPrefs, setPrefs, type Mode } from '../state/prefs'
import { INDUSTRY_ICONS } from './industryIcons'

const HIGHLIGHTS = [
  { icon: CloudOff, title: 'Works offline', text: 'Keep working with no internet. Everything saves instantly.' },
  { icon: Laptop, title: 'Any computer', text: 'Use it in the browser or install it like regular software.' },
  { icon: Smartphone, title: 'Phones & tablets', text: 'A layout built for touch, with a one-tap add button.' },
  { icon: BookCheck, title: 'Real double-entry', text: 'Every transaction balances. Reports your accountant trusts.' },
]

export function Onboarding({ companies }: { companies: Company[] }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const adding = params.get('new') === '1' || companies.length > 0

  const detected = useMemo(detectCountry, [])
  const [step, setStep] = useState(adding ? 1 : 0)
  const [name, setName] = useState('')
  const [countryCode, setCountryCode] = useState(detected)
  const country = getCountry(countryCode)
  const [currency, setCurrency] = useState(country.currency)
  const [fyMonth, setFyMonth] = useState(country.fiscalYearStartMonth)
  const [industry, setIndustry] = useState<IndustryId>('general')
  const [features, setFeatures] = useState<Features>(getIndustry('general').features)
  const [mode, setMode] = useState<Mode>(getPrefs().mode)
  const [busy, setBusy] = useState<'create' | 'demo' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chartSize = buildChart(industry, country.taxAccounts, features).length
  // Arrived here because there were no businesses (e.g. one was deleted on another device), and now there are.
  if (companies.length > 0 && params.get('new') !== '1' && busy === null) return <Navigate to="/" replace />


  const changeCountry = (code: string) => {
    const c = getCountry(code)
    setCountryCode(code)
    setCurrency(c.currency)
    setFyMonth(c.fiscalYearStartMonth)
  }

  const finish = async (company: Company, message: string) => {
    setPrefs({ companyId: company.id, mode })
    navigate('/', { replace: true })
    toast(message)
  }

  const createBooks = async () => {
    setError(null)
    setBusy('create')
    try {
      const company = await createCompany(db, { name, country: countryCode, currency, industry, fiscalYearStartMonth: fyMonth, features })
      await finish(company, `Your books for ${company.name} are ready.`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(null)
    }
  }

  const startDemo = async () => {
    setBusy('demo')
    try {
      const company = await createDemoCompany(db, countryCode)
      await finish(company, 'Demo company loaded with six months of sample data.')
    } catch (err) {
      setError(errorMessage(err))
      setBusy(null)
    }
  }

  const next = (e?: FormEvent) => {
    e?.preventDefault()
    setError(null)
    if (step === 1 && !name.trim()) return setError('Enter your business name.')
    setStep((s) => s + 1)
  }

  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -top-24 -right-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-0 left-0 size-80 rounded-full bg-cyan-300/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <Logo className="size-10 ring-1 ring-white/20" />
          <span className="text-xl font-semibold tracking-tight">Ledgerly</span>
        </div>
        <div className="relative mt-auto mb-auto max-w-md">
          <h2 className="text-4xl leading-tight font-semibold tracking-tight">Accounting that goes wherever you do.</h2>
          <p className="mt-4 text-lg text-indigo-100">Clear books for any business, online or offline, on every device you own.</p>
          <ul className="mt-10 space-y-5">
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block font-medium">{title}</span>
                  <span className="text-sm text-indigo-100/90">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative flex items-center gap-2 text-sm text-indigo-100/80">
          <Lock className="size-4" /> Your data stays on this device. No sign-up needed.
        </p>
      </aside>

      <main className="flex min-h-dvh flex-col px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-10 lg:px-16">
        <div className="flex items-center justify-between lg:justify-end">
          <div className="flex items-center gap-2.5 lg:hidden">
            <Logo />
            <span className="text-lg font-semibold">Ledgerly</span>
          </div>
          {companies.length > 0 && (
            <Link to="/" className="text-sm font-medium text-fg-muted hover:text-fg">
              Back to app
            </Link>
          )}
        </div>

        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-10">
          {step === 0 && (
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary-ink">
                <Sparkles className="size-3.5" /> Free · Private · Offline-ready
              </span>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Let's set up your books.</h1>
              <p className="mt-4 text-lg text-fg-muted">
                Answer three quick questions and Ledgerly builds a chart of accounts and tax setup that fits your business.
              </p>
              <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:hidden">
                {HIGHLIGHTS.map(({ icon: Icon, title }) => (
                  <div key={title} className="flex items-center gap-2.5 text-sm text-fg-muted">
                    <Icon className="size-4 text-primary-ink" /> {title}
                  </div>
                ))}
              </div>
              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <Button variant="primary" size="lg" onClick={() => setStep(1)}>
                  Set up my business <ArrowRight />
                </Button>
                <Button size="lg" onClick={startDemo} disabled={busy !== null}>
                  {busy === 'demo' ? 'Loading demo…' : 'Explore a demo company'}
                </Button>
              </div>
              <p className="mt-6 text-sm text-fg-muted">
                Already use Ledgerly on another device?{' '}
                <Link to="/sign-in" className="font-medium text-primary-ink hover:underline">
                  Sign in to get your books
                </Link>
              </p>
              {error && <p className="mt-4 text-sm text-danger">{error}</p>}
            </div>
          )}

          {step > 0 && <Progress step={step} />}

          {step === 1 && (
            <form onSubmit={next} className="flex flex-col gap-5">
              <StepTitle title="Tell us about your business" text="You can change any of this later in Settings." />
              <Field label="Business name" error={error}>
                {(id, d) => (
                  <Input id={id} aria-describedby={d} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sunrise Traders" autoFocus maxLength={100} className="h-12 text-base" />
                )}
              </Field>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Country" hint="Sets up local taxes and number formats.">
                  {(id, d) => (
                    <Select id={id} aria-describedby={d} value={countryCode} onChange={(e) => changeCountry(e.target.value)} className="h-12">
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Currency">
                  {(id) => (
                    <Select id={id} value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-12">
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} · {c.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <Field label="Financial year starts in" hint="The month your accounting year begins.">
                {(id, d) => (
                  <Select id={id} aria-describedby={d} value={fyMonth} onChange={(e) => setFyMonth(Number(e.target.value))} className="h-12">
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <StepNav onBack={adding ? undefined : () => setStep(0)} nextLabel="Continue" />
              {adding && (
                <p className="text-center text-sm text-fg-subtle">
                  Just looking around?{' '}
                  <button type="button" onClick={startDemo} disabled={busy !== null} className="font-medium text-primary-ink hover:underline">
                    {busy === 'demo' ? 'Loading demo…' : 'Explore the demo company'}
                  </button>
                </p>
              )}
            </form>
          )}

          {step === 2 && (
            <form onSubmit={next} className="flex flex-col gap-5">
              <StepTitle title="What kind of business is it?" text="We'll add the accounts businesses like yours usually need." />
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Industry">
                {INDUSTRIES.map((ind) => {
                  const Icon = INDUSTRY_ICONS[ind.id]
                  const selected = industry === ind.id
                  return (
                    <button
                      key={ind.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setIndustry(ind.id)
                        setFeatures(ind.features)
                      }}
                      className={cn(
                        'flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all',
                        selected ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'border-line bg-surface hover:border-line-strong',
                      )}
                    >
                      <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', selected ? 'bg-primary text-on-primary' : 'bg-surface-2 text-fg-muted')}>
                        <Icon className="size-[18px]" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-fg">{ind.name}</span>
                        <span className="block text-xs leading-snug text-fg-subtle">{ind.description}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
              <StepNav onBack={() => setStep(1)} nextLabel="Continue" />
            </form>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-6">
              <StepTitle title="Just a couple of preferences" text="These shape what you see. Switch any time." />
              <div>
                <p className="mb-2 text-[13px] font-medium text-fg">How familiar are you with accounting?</p>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Accounting experience">
                  <ChoiceCard selected={mode === 'simple'} onClick={() => setMode('simple')} title="Keep it simple" text="Plain words like money in and money out. Jargon stays hidden." />
                  <ChoiceCard selected={mode === 'accountant'} onClick={() => setMode('accountant')} title="I know accounting" text="Account codes, journals, debits and credits up front." />
                </div>
              </div>
              <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
                <Switch
                  checked={features.inventory}
                  onChange={(v) => setFeatures((f) => ({ ...f, inventory: v }))}
                  label="I sell physical products"
                  description="Adds inventory accounts to track the value of your stock."
                />
                <Switch
                  checked={features.projects}
                  onChange={(v) => setFeatures((f) => ({ ...f, projects: v }))}
                  label="I work on projects or jobs"
                  description="Lets you track income and costs per project (coming soon)."
                />
              </div>
              <div className="rounded-xl bg-surface-2 p-4 text-sm text-fg-muted">
                <p className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" />
                  <span>
                    <strong className="font-semibold text-fg">{chartSize} accounts</strong> for a {getIndustry(industry).name.toLowerCase()} business
                  </span>
                </p>
                <p className="mt-2 flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" />
                  <span>
                    <strong className="font-semibold text-fg">{country.taxRates.length ? `${country.taxRates.length} ${country.taxName} rates` : `${country.taxName} accounts`}</strong>{' '}
                    {country.code === 'OTHER' ? 'ready for your local rates' : `for ${country.name}`}
                  </span>
                </p>
                <p className="mt-2 flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" />
                  <span>
                    Amounts in <strong className="font-semibold text-fg">{currency}</strong>, year starting <strong className="font-semibold text-fg">{MONTHS[fyMonth - 1]}</strong>
                  </span>
                </p>
              </div>
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <div className="flex items-center justify-between gap-3">
                <Button variant="ghost" onClick={() => setStep(2)}>
                  <ArrowLeft /> Back
                </Button>
                <Button variant="primary" size="lg" onClick={createBooks} disabled={busy !== null}>
                  {busy === 'create' ? 'Setting up…' : 'Create my books'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function Progress({ step }: { step: number }) {
  return (
    <div className="mb-8">
      <p className="mb-2 text-xs font-semibold tracking-wide text-fg-subtle uppercase">Step {step} of 3</p>
      <div className="flex gap-1.5">
        {[1, 2, 3].map((s) => (
          <span key={s} className={cn('h-1.5 flex-1 rounded-full transition-colors', s <= step ? 'bg-primary' : 'bg-surface-3')} />
        ))}
      </div>
    </div>
  )
}

function StepTitle({ title, text }: { title: string; text: string }) {
  return (
    <div className="mb-1">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-1.5 text-fg-muted">{text}</p>
    </div>
  )
}

function StepNav({ onBack, nextLabel }: { onBack?: () => void; nextLabel: string }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-3">
      {onBack ? (
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
      ) : (
        <span />
      )}
      <Button variant="primary" size="lg" type="submit">
        {nextLabel} <ArrowRight />
      </Button>
    </div>
  )
}

function ChoiceCard({ selected, onClick, title, text }: { selected: boolean; onClick: () => void; title: string; text: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'relative rounded-xl border p-4 text-left transition-all',
        selected ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      {selected && (
        <span className="absolute top-3 right-3 grid size-5 place-items-center rounded-full bg-primary text-on-primary">
          <Check className="size-3" />
        </span>
      )}
      <span className="block text-sm font-semibold text-fg">{title}</span>
      <span className="mt-1 block text-xs leading-snug text-fg-subtle">{text}</span>
    </button>
  )
}
