import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { settledAmounts } from '../accounting/documents'
import { loadAccounts, loadLines } from '../accounting/reports'
import { db } from '../db'
import type { DocType } from '../db/types'

export function useAccounts(companyId: string) {
  return useLiveQuery(() => loadAccounts(db, companyId), [companyId])
}

export function useLines(companyId: string, from?: string, to?: string) {
  return useLiveQuery(() => loadLines(db, companyId, from, to), [companyId, from, to])
}

export function useContacts(companyId: string) {
  return useLiveQuery(() => db.contacts.where('companyId').equals(companyId).toArray(), [companyId])
}

export function useItems(companyId: string) {
  return useLiveQuery(() => db.items.where('companyId').equals(companyId).toArray(), [companyId])
}

export function useTaxRates(companyId: string) {
  return useLiveQuery(() => db.taxRates.where('companyId').equals(companyId).toArray(), [companyId])
}

export function useDocuments(companyId: string, type?: DocType) {
  return useLiveQuery(
    () => (type ? db.documents.where('[companyId+type]').equals([companyId, type]).toArray() : db.documents.where('companyId').equals(companyId).toArray()),
    [companyId, type],
  )
}

export function usePayments(companyId: string) {
  return useLiveQuery(() => db.payments.where('companyId').equals(companyId).toArray(), [companyId])
}

export function useStockMoves(companyId: string) {
  return useLiveQuery(() => db.stockMoves.where('companyId').equals(companyId).toArray(), [companyId])
}

/** Every document and payment, plus how much has been paid or credited against each invoice and bill. */
export function useLedgerDocs(companyId: string) {
  const docs = useDocuments(companyId)
  const payments = usePayments(companyId)
  const settled = useMemo(() => (docs && payments ? settledAmounts(docs, payments) : undefined), [docs, payments])
  return { docs, payments, settled }
}
