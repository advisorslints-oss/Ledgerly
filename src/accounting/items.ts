import type { LedgerDB } from '../db/database'
import type { Item, StockMove } from '../db/types'
import { newId } from '../lib/id'
import { postGeneratedEntry, requireCompany } from './engine'
import { AccountingError } from './errors'

export interface ItemInput {
  kind: Item['kind']
  name: string
  sku?: string
  unit?: string
  description?: string
  salePrice: number
  purchasePrice: number
  salesAccountId?: string
  purchaseAccountId?: string
  salesTaxRateId?: string
  purchaseTaxRateId?: string
  trackStock: boolean
  inventoryAccountId?: string
  reorderLevel?: number
}

/** Quantities keep up to 4 decimal places (e.g. 1.25 kg, 0.5 hours). */
export const roundQty = (q: number) => Math.round(q * 10_000) / 10_000

export async function saveItem(db: LedgerDB, companyId: string, input: ItemInput, id?: string): Promise<Item> {
  const name = input.name.trim()
  if (!name) throw new AccountingError('Enter a name.')
  for (const [label, v] of [['Selling price', input.salePrice], ['Cost price', input.purchasePrice]] as const) {
    if (!Number.isSafeInteger(v) || v < 0) throw new AccountingError(`${label} must be zero or more.`)
  }
  if (input.kind === 'service' && input.trackStock) throw new AccountingError("Services don't have stock to track.")

  return db.write(async () => {
    const company = await requireCompany(db, companyId)
    const current = id ? await db.items.get(id) : undefined
    if (id && (!current || current.companyId !== companyId)) throw new AccountingError('Item not found.', 'not_found')
    const lower = name.toLowerCase()
    const sku = input.sku?.trim() || undefined
    const all = await db.items.where('companyId').equals(companyId).toArray()
    if (all.some((i) => i.id !== id && !i.archived && i.name.toLowerCase() === lower)) throw new AccountingError(`You already have an item called "${name}".`, 'conflict')
    if (sku && all.some((i) => i.id !== id && i.sku?.toLowerCase() === sku.toLowerCase())) throw new AccountingError(`SKU ${sku} is already used.`, 'conflict')

    let inventoryAccountId = input.inventoryAccountId
    if (input.trackStock) {
      if (!company.features.inventory) throw new AccountingError('Turn on inventory in Settings → Business to track stock.')
      if (!inventoryAccountId) {
        const inv = await db.accounts.where('[companyId+systemKey]').equals([companyId, 'inventory']).first()
        inventoryAccountId = inv?.id ?? (await db.accounts.where('companyId').equals(companyId).filter((a) => a.subtype === 'inventory').first())?.id
      }
      if (!inventoryAccountId) throw new AccountingError('Add an inventory account first.')
    }
    if (current?.trackStock && !input.trackStock && (await db.stockMoves.where('itemId').equals(current.id).count())) {
      throw new AccountingError('This item has stock movements, so stock tracking stays on.')
    }

    const at = Date.now()
    const item: Item = {
      id: current?.id ?? newId(),
      companyId,
      kind: input.kind,
      name,
      sku,
      unit: input.unit?.trim() || undefined,
      description: input.description?.trim() || undefined,
      salePrice: input.salePrice,
      purchasePrice: input.purchasePrice,
      salesAccountId: input.salesAccountId || undefined,
      purchaseAccountId: input.trackStock ? inventoryAccountId : input.purchaseAccountId || undefined,
      salesTaxRateId: input.salesTaxRateId || undefined,
      purchaseTaxRateId: input.purchaseTaxRateId || undefined,
      trackStock: input.trackStock,
      inventoryAccountId: input.trackStock ? inventoryAccountId : undefined,
      reorderLevel: input.reorderLevel,
      archived: current?.archived ?? false,
      createdAt: current?.createdAt ?? at,
      updatedAt: at,
    }
    await db.items.put(item)
    await db.track(companyId, 'items', item.id)
    await db.logAudit(companyId, current ? 'update' : 'create', 'item', item.id, `${current ? 'Updated' : 'Added'} item ${item.name}`)
    return item
  })
}

export async function setItemArchived(db: LedgerDB, id: string, archived: boolean): Promise<void> {
  await db.write(async () => {
    const item = await db.items.get(id)
    if (!item) throw new AccountingError('Item not found.', 'not_found')
    await db.items.update(id, { archived, updatedAt: Date.now() })
    await db.track(item.companyId, 'items', id, { fields: ['archived', 'updatedAt'] })
  })
}

export async function deleteItem(db: LedgerDB, id: string): Promise<void> {
  await db.write(async () => {
    const item = await db.items.get(id)
    if (!item) return
    const used = await db.documents
      .where('companyId')
      .equals(item.companyId)
      .filter((d) => d.lines.some((l) => l.itemId === id))
      .count()
    if (used || (await db.stockMoves.where('itemId').equals(id).count())) throw new AccountingError(`${item.name} is used in transactions. Archive it instead.`, 'conflict')
    await db.items.delete(id)
    await db.track(item.companyId, 'items', id, { op: 'delete' })
    await db.logAudit(item.companyId, 'delete', 'item', id, `Deleted item ${item.name}`)
  })
}

export interface StockLevel {
  quantity: number
  value: number
  /** Average cost per unit, in minor units (may be fractional). */
  averageCost: number
}

/** Running stock and weighted-average value per item. */
export function stockLevels(moves: Pick<StockMove, 'itemId' | 'quantity' | 'value'>[]): Map<string, StockLevel> {
  const map = new Map<string, StockLevel>()
  for (const m of moves) {
    const s = map.get(m.itemId) ?? { quantity: 0, value: 0, averageCost: 0 }
    s.quantity = roundQty(s.quantity + m.quantity)
    s.value += m.value
    s.averageCost = s.quantity > 0 ? s.value / s.quantity : 0
    map.set(m.itemId, s)
  }
  return map
}

/** Average cost of one unit right now, falling back to the item's cost price when nothing is in stock. */
export async function currentUnitCost(db: LedgerDB, item: Item, excludeSourceId?: string): Promise<number> {
  const moves = (await db.stockMoves.where('itemId').equals(item.id).toArray()).filter((m) => m.sourceId !== excludeSourceId)
  const level = stockLevels(moves).get(item.id)
  return level && level.quantity > 0 && level.averageCost > 0 ? level.averageCost : item.purchasePrice
}

export interface StockAdjustmentInput {
  itemId: string
  date: string
  /** Positive adds stock, negative removes it. */
  quantity: number
  /** Cost per unit for stock added; defaults to the current average cost. */
  unitCost?: number
  /** The other side of the entry, e.g. Inventory Shrinkage or Opening Balance Equity. */
  accountId: string
  reason?: string
}

/** Corrects stock on hand (counts, damage, opening stock) and posts the change in value. */
export async function adjustStock(db: LedgerDB, companyId: string, input: StockAdjustmentInput): Promise<void> {
  const quantity = roundQty(input.quantity)
  if (!quantity) throw new AccountingError('Enter how many units to add or remove.')
  await db.write(async () => {
    const item = await db.items.get(input.itemId)
    if (!item || item.companyId !== companyId) throw new AccountingError('Item not found.', 'not_found')
    if (!item.trackStock || !item.inventoryAccountId) throw new AccountingError(`Stock isn't tracked for ${item.name}.`)
    const unitCost = quantity > 0 && input.unitCost !== undefined ? input.unitCost : await currentUnitCost(db, item)
    const value = Math.round(Math.abs(quantity) * unitCost)
    const id = newId()
    const memo = `Stock adjustment · ${item.name} ${quantity > 0 ? '+' : ''}${quantity}${input.reason ? ` · ${input.reason}` : ''}`
    if (value > 0) {
      await postGeneratedEntry(db, companyId, {
        date: input.date,
        memo,
        source: 'stock',
        docId: id,
        lines:
          quantity > 0
            ? [{ accountId: item.inventoryAccountId, debit: value }, { accountId: input.accountId, credit: value }]
            : [{ accountId: input.accountId, debit: value }, { accountId: item.inventoryAccountId, credit: value }],
      })
    }
    const move: StockMove = {
      id,
      companyId,
      itemId: item.id,
      date: input.date,
      quantity,
      unitCost: Math.round(unitCost),
      value: quantity > 0 ? value : -value,
      sourceType: 'adjustment',
      sourceId: id,
      createdAt: Date.now(),
    }
    await db.stockMoves.add(move)
    await db.track(companyId, 'stockMoves', id)
    await db.logAudit(companyId, 'adjust', 'item', item.id, memo)
  })
}
