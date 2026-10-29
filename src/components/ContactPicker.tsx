import { useState } from 'react'
import { isCustomer, isSupplier } from '../accounting/contacts'
import type { ContactType } from '../db/types'
import { useCompany } from '../state/company'
import { useContacts } from '../state/data'
import { Combobox } from './Combobox'
import { ContactDialog } from './ContactDialog'

interface Props {
  type: 'customer' | 'supplier'
  value: string
  onChange: (id: string) => void
  id?: string
  invalid?: boolean
  placeholder?: string
}

/** Pick a customer or supplier, or add a new one without leaving the form. */
export function ContactPicker({ type, value, onChange, id, invalid, placeholder }: Props) {
  const company = useCompany()
  const contacts = useContacts(company.id) ?? []
  const [creating, setCreating] = useState<string | null>(null)
  const match = type === 'customer' ? isCustomer : isSupplier
  const options = contacts
    .filter((c) => match(c) && (!c.archived || c.id === value))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, label: c.name, hint: c.email }))

  return (
    <>
      <Combobox
        id={id}
        options={options}
        value={value}
        onChange={onChange}
        invalid={invalid}
        placeholder={placeholder ?? (type === 'customer' ? 'Choose or add a customer' : 'Choose or add a supplier')}
        onCreate={(text) => setCreating(text)}
        createLabel={(text) => `Add "${text}" as a new ${type}`}
      />
      <ContactDialog
        open={creating !== null}
        onClose={() => setCreating(null)}
        type={type as ContactType}
        initialName={creating ?? ''}
        onSaved={(c) => onChange(c.id)}
      />
    </>
  )
}
