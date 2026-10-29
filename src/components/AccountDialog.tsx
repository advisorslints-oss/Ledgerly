import { useEffect, useState, type FormEvent } from 'react'
import { ACCOUNT_TYPES, createAccount, subtypesFor, suggestCode, TYPE_HELP, TYPE_LABELS, updateAccount } from '../accounting/accounts'
import { errorMessage } from '../accounting/errors'
import { db } from '../db'
import type { Account, AccountSubtype, AccountType } from '../db/types'
import { useCompany } from '../state/company'
import { usePrefs } from '../state/prefs'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Field, Input, Select, Textarea } from './ui/form'
import { useToast } from './ui/toast'

interface Props {
  open: boolean
  onClose: () => void
  accounts: Account[]
  account?: Account
  onSaved?: (account: Account) => void
  /** Starting type for a new account, e.g. a bank account from the Banking section. */
  defaults?: { type: AccountType; subtype: AccountSubtype }
}

const SINGULAR: Record<AccountType, string> = { asset: 'Asset', liability: 'Liability', equity: 'Equity', income: 'Income', expense: 'Expense' }

export function AccountDialog({ open, onClose, accounts, account, onSaved, defaults }: Props) {
  const company = useCompany()
  const { mode } = usePrefs()
  const toast = useToast()
  const [type, setType] = useState<AccountType>('expense')
  const [subtype, setSubtype] = useState<AccountSubtype>('operating_expense')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [codeTouched, setCodeTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setCodeTouched(!!account)
    setType(account?.type ?? defaults?.type ?? 'expense')
    setSubtype(account?.subtype ?? defaults?.subtype ?? 'operating_expense')
    setName(account?.name ?? '')
    setCode(account?.code ?? suggestCode(accounts, defaults?.subtype ?? 'operating_expense'))
    setDescription(account?.description ?? '')
    // Reset only when the dialog opens or switches account, not on every accounts update.
  }, [open, account?.id])

  const changeSubtype = (next: AccountSubtype) => {
    setSubtype(next)
    if (!codeTouched) setCode(suggestCode(accounts, next))
  }
  const changeType = (next: AccountType) => {
    setType(next)
    changeSubtype(subtypesFor(next)[0].id)
  }

  const locked = !!account?.systemKey
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const input = { code, name, type, subtype, description }
      const saved = account ? await updateAccount(db, account.id, input) : await createAccount(db, company.id, input)
      toast(account ? 'Account updated' : `Added ${saved.name}`)
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={account ? 'Edit account' : 'New account'}
      description={account ? undefined : 'Accounts are the categories your money is sorted into.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="account-form" disabled={busy}>
            {account ? 'Save changes' : 'Add account'}
          </Button>
        </>
      }
    >
      <form id="account-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Account type" hint={TYPE_HELP[type]}>
          {(id, d) => (
            <Select id={id} aria-describedby={d} value={type} disabled={locked} onChange={(e) => changeType(e.target.value as AccountType)}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SINGULAR[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Detail type" hint={locked ? 'This account is used by the app, so its type is fixed.' : undefined}>
          {(id, d) => (
            <Select id={id} aria-describedby={d} value={subtype} disabled={locked} onChange={(e) => changeSubtype(e.target.value as AccountSubtype)}>
              {subtypesFor(type).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Field label="Name">
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${TYPE_LABELS[type] === 'Expenses' ? 'Fuel' : 'Savings account'}`} data-autofocus maxLength={120} required />}
          </Field>
          <Field label="Code" hint={mode === 'simple' ? 'Picked for you' : undefined}>
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value)
                  setCodeTouched(true)
                }}
                maxLength={20}
                className="tabular-nums"
                required
              />
            )}
          </Field>
        </div>
        <Field label="Description" hint="Optional: what belongs in this account.">
          {(id, d) => <Textarea id={id} aria-describedby={d} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={2} />}
        </Field>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </form>
    </Dialog>
  )
}
