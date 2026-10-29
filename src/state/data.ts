import { useLiveQuery } from 'dexie-react-hooks'
import { loadAccounts, loadLines } from '../accounting/reports'
import { db } from '../db'

export function useAccounts(companyId: string) {
  return useLiveQuery(() => loadAccounts(db, companyId), [companyId])
}

export function useLines(companyId: string, from?: string, to?: string) {
  return useLiveQuery(() => loadLines(db, companyId, from, to), [companyId, from, to])
}
