import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { FileText, MessageSquare, Trash2, UploadCloud } from 'lucide-react'
import type { UploadedDocument } from '../../hooks/useDocuments'
import { ACCEPTED_EXTENSIONS, MAX_FILE_SIZE_BYTES, formatFileSize } from '../../hooks/useDocuments'
import { cn } from '../../lib/cn'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'

export interface DocumentPanelProps {
  documents: UploadedDocument[]
  onFiles: (files: File[]) => void
  onRemove: (id: string) => void
  onClear: () => void
  serverDocuments?: Array<any>
  onServerRemove?: (id: string) => void
  onChatWithDocument?: (id: string) => void
  uploading?: boolean
  uploadError?: string | null
  onServerUpload?: (files: File[]) => void
}

const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(',')

export function DocumentPanel({
  documents,
  onFiles,
  onRemove,
  onClear,
  serverDocuments = [],
  onServerRemove,
  onChatWithDocument,
  uploading = false,
  uploadError = null,
  onServerUpload,
}: DocumentPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const serverInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0) onFiles(files)
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) onFiles(files)
  }

  const handleServerInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0 && onServerUpload) onServerUpload(files)
    event.target.value = ''
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'rounded-2xl border border-dashed px-6 py-10 text-center transition-colors',
          isDragging ? 'border-brand bg-brand-soft/40' : 'border-line-strong bg-surface/50',
        )}
      >
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
          <UploadCloud className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-ink">Drop files here to attach them</p>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-ink-subtle">
          {ACCEPTED_EXTENSIONS.join(' ')} · up to {formatFileSize(MAX_FILE_SIZE_BYTES)} per file
        </p>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          onChange={handleInputChange}
          className="hidden"
        />

        <Button
          variant="secondary"
          className="mt-5"
          onClick={() => inputRef.current?.click()}
          leadingIcon={<UploadCloud className="h-4 w-4" aria-hidden="true" />}
        >
          Browse files
        </Button>
      </div>

      <div className="rounded-2xl border border-line bg-surface/60">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium text-ink">Attached documents</h2>
          {documents.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear all
            </Button>
          ) : null}
        </div>

        {documents.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-ink-subtle">
            No documents attached yet.
          </p>
        ) : (
          <ul className="divide-y divide-line/70">
            {documents.map((document) => (
              <li key={document.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-raised text-ink-muted">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{document.name}</p>
                  <p className="text-[11px] text-ink-subtle">
                    {formatFileSize(document.size)}
                    {document.note ? ` · ${document.note}` : ''}
                  </p>
                </div>

                <Badge tone={document.status === 'queued' ? 'brand' : 'danger'}>
                  {document.status === 'queued' ? 'Queued' : 'Rejected'}
                </Badge>

                <IconButton
                  label={`Remove ${document.name}`}
                  size="sm"
                  icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={() => onRemove(document.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-surface/60">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium text-ink">Documents</h2>
          <Button variant="secondary" size="sm" onClick={() => serverInputRef.current?.click()} disabled={uploading}>
            Attach files
          </Button>
        </div>
        <input
          ref={serverInputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md,.docx,.doc,.csv,.json,.html,.htm"
          onChange={handleServerInputChange}
          className="hidden"
        />
        {uploading ? (
          <p className="px-4 py-3 text-xs text-ink-subtle">Uploading and ingesting...</p>
        ) : null}
        {uploadError ? (
          <p className="px-4 py-3 text-xs text-danger">{uploadError}</p>
        ) : null}
        {serverDocuments.length === 0 && !uploading ? (
          <p className="px-4 py-8 text-center text-xs text-ink-subtle">No PDFs uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-line/70">
            {serverDocuments.map((doc: any) => (
              <li key={doc.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-raised text-ink-muted">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{doc.filename}</p>
                  <p className="text-[11px] text-ink-subtle">
                    Status: {doc.status}
                    {doc.page_count ? ` · ${doc.page_count} pages` : ''}
                    {doc.size_bytes ? ` · ${formatFileSize(doc.size_bytes)}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {doc.status === 'ready' && onChatWithDocument ? (
                    <Button variant="ghost" size="sm" leadingIcon={<MessageSquare className="h-3.5 w-3.5" />} onClick={() => onChatWithDocument(doc.id)}>
                      Chat with this document
                    </Button>
                  ) : null}
                  {confirmDelete === doc.id ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
                        Cancel
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        onClick={() => {
                          onServerRemove?.(doc.id)
                          setConfirmDelete(null)
                        }}
                      >
                        Confirm delete
                      </Button>
                    </>
                  ) : (
                    <IconButton
                      label={`Delete ${doc.filename}`}
                      size="sm"
                      icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => setConfirmDelete(doc.id)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="rounded-xl border border-line bg-surface/40 px-4 py-3 text-[11px] leading-relaxed text-ink-subtle">
        Attach files directly to upload. Supported types include PDF, TXT, MD, DOCX, DOC, CSV, JSON, HTML. Only you can access your documents.
      </p>
    </div>
  )
}
