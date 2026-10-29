import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, FileText, Paperclip, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { addAttachment, deleteAttachment } from '../accounting/attachments'
import { errorMessage } from '../accounting/errors'
import { db } from '../db'
import type { Attachment } from '../db/types'
import { useCompany } from '../state/company'
import { Button } from './ui/button'
import { useToast } from './ui/toast'

/** Receipts, signed copies and other files kept with a document. Photos can come straight from a phone camera. */
export function Attachments({ parentId, readOnly }: { parentId: string; readOnly?: boolean }) {
  const company = useCompany()
  const toast = useToast()
  const files = useLiveQuery(() => db.attachments.where('parentId').equals(parentId).toArray(), [parentId]) ?? []
  const pickRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  const add = async (list: FileList | null) => {
    if (!list?.length) return
    setBusy(true)
    try {
      for (const f of Array.from(list)) await addAttachment(db, company.id, parentId, f)
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (readOnly && !files.length) return null

  return (
    <div
      onDragOver={(e) => {
        if (readOnly) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (readOnly) return
        e.preventDefault()
        setDragging(false)
        void add(e.dataTransfer.files)
      }}
      className={dragging ? 'rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-surface' : undefined}
    >
      <div className="flex flex-wrap gap-3">
        {files.map((f) => (
          <FileTile key={f.id} file={f} onRemove={readOnly ? undefined : () => void deleteAttachment(db, f.id)} />
        ))}
      </div>
      {!readOnly && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" icon={<Paperclip />} onClick={() => pickRef.current?.click()} disabled={busy}>
            Attach file
          </Button>
          <Button size="sm" icon={<Camera />} onClick={() => cameraRef.current?.click()} disabled={busy} className="sm:hidden">
            Take photo
          </Button>
          <span className="hidden text-xs text-fg-subtle sm:inline">or drop files here · images and PDFs up to 10 MB</span>
          <input ref={pickRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => (void add(e.target.files), (e.target.value = ''))} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => (void add(e.target.files), (e.target.value = ''))} />
        </div>
      )}
    </div>
  )
}

function FileTile({ file, onRemove }: { file: Attachment; onRemove?: () => void }) {
  const url = useMemo(() => URL.createObjectURL(file.data), [file.data])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  const image = file.type.startsWith('image/')
  if (file.missing) {
    return (
      <div title={file.name} className="flex size-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong bg-surface-2 p-2 text-center">
        <FileText className="size-5 text-fg-subtle" />
        <span className="text-[11px] text-fg-subtle">Downloads on next sync</span>
      </div>
    )
  }
  return (
    <div className="group relative">
      <a href={url} target="_blank" rel="noreferrer" title={file.name} className="block size-24 overflow-hidden rounded-xl border border-line bg-surface-2">
        {image ? (
          <img src={url} alt={file.name} className="size-full object-cover" />
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center">
            <FileText className="size-6 text-fg-subtle" />
            <span className="line-clamp-2 text-[11px] break-all text-fg-muted">{file.name}</span>
          </span>
        )}
      </a>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${file.name}`}
          className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full border border-line bg-surface text-fg-subtle shadow-card hover:text-danger"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
