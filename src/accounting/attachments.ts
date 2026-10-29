import type { LedgerDB } from '../db/database'
import type { Attachment } from '../db/types'
import { newId } from '../lib/id'
import { AccountingError } from './errors'

const MAX_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_SIDE = 2000

/** Shrinks large photos (phone cameras make 5–10 MB images) so receipts stay small on the device. */
async function shrinkImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 1_500_000) return file
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
    return blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

export async function addAttachment(db: LedgerDB, companyId: string, parentId: string, file: File): Promise<Attachment> {
  const data = await shrinkImage(file)
  if (data.size > MAX_BYTES) throw new AccountingError(`${file.name} is larger than 10 MB.`)
  const attachment: Attachment = {
    id: newId(),
    companyId,
    parentId,
    name: file.name || 'Attachment',
    type: data.type || file.type || 'application/octet-stream',
    size: data.size,
    data,
    createdAt: Date.now(),
  }
  await db.write(async () => {
    await db.attachments.add(attachment)
    await db.track(companyId, 'attachments', attachment.id)
  })
  return attachment
}

export async function deleteAttachment(db: LedgerDB, id: string): Promise<void> {
  await db.write(async () => {
    const a = await db.attachments.get(id)
    if (!a) return
    await db.attachments.delete(id)
    await db.track(a.companyId, 'attachments', id, { op: 'delete' })
  })
}
