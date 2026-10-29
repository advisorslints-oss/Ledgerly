import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from 'lucide-react'
import { createContext, useContext, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { postEntry } from '../accounting/engine'
import { errorMessage } from '../accounting/errors'
import { db } from '../db'
import type { Account, AccountType } from '../db/types'
import { today } from '../lib/dates'
import { useCompany } from '../state/company'
import { usePrefs } from '../state/prefs'
import { AccountPicker } from './AccountPicker'
import { AmountInput } from './AmountInput'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Field, Input } from './ui/form'
import { Segmented } from './ui/misc'
import { useToast } from './ui/toast'

export type QuickKind = 'in' | 'out' | 'transfer'

const QuickEntryContext = createContext<(kind?: QuickKind) => void>(() => {})

export function useQuickEntry() {
  return useContext(QuickEntryContext)
}

export function QuickEntryProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<QuickKind | null>(null)
  return (
    <QuickEntryContext.Provider value={(k = 'in') => setKind(k)}>
      {children}
      {kind && <QuickEntryDialog initialKind={kind} onClose={() => setKind(null)} />}
    </QuickEntryContext.Provider>
  )
}

const MONEY_SUBTYPES = new Set(['cash', 'bank', 'credit_card'])
const isMoney = (a: Account) => MONEY_SUBTYPES.has(a.subtype)

const CATEGORY_ORDER: Record<QuickKind, AccountType[]> = {
  in: ['income', 'liability', 'equity', 'asset', 'expense'],
  out: ['expense', 'asset', 'liability', 'equity', 'income'],
  transfer: ['asset', 'liability'],
}

const COPY: Record<QuickKind, { title: string; money: string; category: string; categoryHint: string; memo: string }> = {
  in: {
    title: 'Record money in',
    money: 'Received into',
    category: 'What was it for?',
    categoryHint: 'Usually an income account, e.g. Sales. Pick a loan or capital account for money borrowed or invested.',
    memo: 'e.g. Cash sales for the week',
  },
  out: {
    title: 'Record money out',
    money: 'Paid from',
    category: 'What was it for?',
    categoryHint: 'Usually an expense account, e.g. Rent. Pick an asset for equipment, or a loan to record a repayment.',
    memo: 'e.g. October rent',
  },
  transfer: {
    title: 'Transfer between accounts',
    money: 'From',
    category: 'To',
    categoryHint: 'Moves money between your own cash, bank and card accounts. It is not income or an expense.',
    memo: 'e.g. Cash deposited to bank',
  },
}

function QuickEntryDialog({ initialKind, onClose }: { initialKind: QuickKind; onClose: () => void }) {
  const company = useCompany()
  const { mode } = usePrefs()
  const toast = useToast()
  const accounts = useLiveQuery(() => db.accounts.where('companyId').equals(company.id).toArray(), [company.id]) ?? []
  const moneyAccounts = accounts.filter(isMoney)
  const defaultMoney = moneyAccounts.find((a) => a.systemKey === 'bank')?.id ?? moneyAccounts[0]?.id ?? ''

  const [kind, setKind] = useState<QuickKind>(initialKind)
  const [moneyId, setMoneyId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [amount, setAmount] = useState(0)
  const [date, setDate] = useState(today())
  const [memo, setMemo] = useState('')
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const money = moneyId || defaultMoney
  const copy = COPY[kind]
  const categoryAccounts = kind === 'transfer' ? moneyAccounts.filter((a) => a.id !== money) : accounts.filter((a) => !isMoney(a))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!money) return setError(`Choose the account for "${copy.money}".`)
    if (!categoryId) return setError(kind === 'transfer' ? 'Choose where the money went.' : 'Choose what it was for.')
    if (amount <= 0) return setError('Enter an amount greater than zero.')

    const [debitId, creditId] = kind === 'in' ? [money, categoryId] : kind === 'out' ? [categoryId, money] : [categoryId, money]
    setBusy(true)
    try {
      const entry = await postEntry(db, {
        companyId: company.id,
        date,
        memo,
        reference,
        lines: [
          { accountId: debitId, debit: amount },
          { accountId: creditId, credit: amount },
        ],
      })
      toast(
        <span>
          Recorded{' '}
          <Link to={`/journal/${entry.id}`} className="font-medium text-primary-ink underline-offset-2 hover:underline">
            {entry.number}
          </Link>
        </span>,
      )
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={copy.title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="quick-entry" disabled={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="quick-entry" onSubmit={submit} className="flex flex-col gap-4">
        <Segmented
          label="Transaction type"
          value={kind}
          onChange={(k) => {
            setKind(k)
            setCategoryId('')
            setError(null)
          }}
          className="w-full [&>button]:flex-1"
          options={[
            { value: 'in', label: <span className="inline-flex items-center gap-1.5"><ArrowDownLeft className="size-3.5" />Money in</span> },
            { value: 'out', label: <span className="inline-flex items-center gap-1.5"><ArrowUpRight className="size-3.5" />Money out</span> },
            { value: 'transfer', label: <span className="inline-flex items-center gap-1.5"><ArrowLeftRight className="size-3.5" />Transfer</span> },
          ]}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="Amount">
            {(id) => <AmountInput id={id} value={amount} onChange={setAmount} data-autofocus className="h-12 text-lg font-semibold" />}
          </Field>
          <Field label="Date">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-12 sm:w-44" required />}</Field>
        </div>
        <Field label={copy.money}>
          {(id) => (
            <AccountPicker id={id} accounts={moneyAccounts} value={money} onChange={setMoneyId} showCodes={mode === 'accountant'} groupOrder={['asset', 'liability']} />
          )}
        </Field>
        <Field label={copy.category} hint={copy.categoryHint}>
          {(id, describedBy) => (
            <AccountPicker
              id={id}
              aria-describedby={describedBy}
              accounts={categoryAccounts}
              value={categoryId}
              onChange={setCategoryId}
              showCodes={mode === 'accountant'}
              groupOrder={CATEGORY_ORDER[kind]}
              placeholder={kind === 'transfer' ? 'Choose an account' : 'Search, e.g. rent, sales, fuel'}
            />
          )}
        </Field>
        <Field label="Description">{(id) => <Input id={id} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={copy.memo} maxLength={200} />}</Field>
        <Field label="Reference" hint="Optional: receipt, cheque or invoice number.">
          {(id, d) => <Input id={id} aria-describedby={d} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />}
        </Field>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </form>
    </Dialog>
  )
}
