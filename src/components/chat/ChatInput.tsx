import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import {
  AlertCircle,
  ArrowUp,
  Check,
  FileText,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import { Spinner } from '../ui/Spinner'

export interface AttachedFile {
  id: string
  name: string
  status?: string
}

export interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  isStreaming: boolean
  sendOnEnter: boolean
  attachedFiles?: AttachedFile[]
  availableFiles?: AttachedFile[]
  onAttachFiles?: (files: File[]) => void
  onAttachExisting?: (id: string) => void
  onRemoveAttached?: (id: string) => void
  onDeleteServerDocument?: (id: string) => void
  onReindexDocument?: (id: string) => void
  reindexingIds?: Record<string, boolean>
  uploadingFiles?: string[]
  uploadError?: string | null
  onDismissUploadError?: () => void
  onRetryUpload?: () => void
  maxChars: number
  disabled?: boolean
  disabledReason?: string
}

const MAX_TEXTAREA_HEIGHT = 220

const STATUS_LABELS: Record<string, string> = {
  uploading: 'Uploading',
  processing: 'Processing',
  completed: 'Ready',
  pending: 'Queued',
  queued: 'Queued',
  rejected: 'Rejected',
  failed: 'Failed',
  error: 'Upload failed',
}

function statusLabel(status?: string): string {
  if (!status) return 'Attached'
  return STATUS_LABELS[status] ?? status
}

function StatusDot({ status }: { status?: string }) {
  const isReady = status === 'completed'
  const isError = status === 'failed' || status === 'error' || status === 'rejected'
  const isProcessing =
    status === 'uploading' || status === 'processing' || status === 'pending' || status === 'queued'

  return (
    <span
      className={cn(
        'h-1.5 w-1.5 shrink-0 rounded-full',
        isReady && 'bg-success',
        isError && 'bg-danger',
        isProcessing && 'animate-pulse bg-warning',
        !isReady && !isError && !isProcessing && 'bg-ink-subtle',
      )}
      aria-hidden="true"
    />
  )
}

export function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  isStreaming,
  sendOnEnter,
  attachedFiles = [],
  availableFiles = [],
  onAttachFiles,
  onAttachExisting,
  onRemoveAttached,
  onDeleteServerDocument,
  onReindexDocument,
  reindexingIds = {},
  uploadingFiles = [],
  uploadError = null,
  onDismissUploadError,
  onRetryUpload,
  maxChars,
  disabled = false,
  disabledReason,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [showAttach, setShowAttach] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [value])

  useEffect(() => {
    if (!showAttach) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setShowAttach(false)
        setConfirmDeleteId(null)
      }
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowAttach(false)
        setConfirmDeleteId(null)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showAttach])

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') return

    const isModifierSend = event.metaKey || event.ctrlKey
    const isPlainSend = sendOnEnter && !event.shiftKey

    if (isModifierSend || isPlainSend) {
      event.preventDefault()
      if (!disabled && !isStreaming && value.trim().length > 0) onSend()
    }
  }

  const submitFiles = (files: File[]) => {
    if (files.length === 0 || !onAttachFiles) return
    onAttachFiles(files)
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    submitFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    submitFiles(Array.from(event.dataTransfer.files ?? []))
  }

  const toggleAttach = () => {
    setConfirmDeleteId(null)
    setShowAttach((current) => !current)
  }

  const totalAttached = attachedFiles.length
  const allReady =
    totalAttached > 0 && attachedFiles.every((file) => file.status === 'completed')
  const hasFailed = attachedFiles.some(
    (file) => file.status === 'failed' || file.status === 'error' || file.status === 'rejected',
  )
  const isUploading = uploadingFiles.length > 0
  const isProcessing = attachedFiles.some(
    (file) =>
      file.status === 'uploading' || file.status === 'processing' || file.status === 'pending',
  )
  const isQueued = attachedFiles.some((file) => file.status === 'queued')
  const charactersLeft = maxChars - value.length

  return (
    <div className="shrink-0 px-4 pt-2 pb-4 sm:px-6 sm:pb-6">
      <div className="mx-auto w-full max-w-3xl">
        {disabled && disabledReason ? (
          <p className="mb-2 rounded-xl border border-warning/25 bg-warning-soft px-3.5 py-2.5 text-xs leading-relaxed text-warning">
            {disabledReason}
          </p>
        ) : null}

        {uploadError && !showAttach ? (
          <div
            role="alert"
            className="mb-2 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-danger">{uploadError}</p>
            {onRetryUpload ? (
              <button
                type="button"
                onClick={onRetryUpload}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-danger underline-offset-2 hover:underline"
              >
                Retry
              </button>
            ) : null}
            {onDismissUploadError ? (
              <button
                type="button"
                onClick={onDismissUploadError}
                aria-label="Dismiss upload error"
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-danger/80 hover:bg-danger/10 hover:text-danger"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}

        <div ref={containerRef} className="relative">
          {showAttach ? (
            <div
              id="document-panel"
              aria-label="Document attachments"
              className="absolute inset-x-0 bottom-full z-20 mb-3 max-h-[min(70vh,32rem)] overflow-y-auto rounded-2xl border border-line-strong bg-[#17181f] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)]"
            >
              <div className="flex items-start justify-between gap-3 border-b border-line/70 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">Documents</p>
                  <p className="mt-0.5 text-[11px] text-ink-subtle">
                    {totalAttached} attached Â· Documents up to 25 MB
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowAttach(false)
                    setConfirmDeleteId(null)
                  }}
                  aria-label="Close document panel"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition-colors hover:bg-surface-hover hover:text-ink"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="space-y-3 p-4">
                <div
                  onDragOver={(event) => {
                    event.preventDefault()
                    setIsDragging(true)
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={cn(
                    'rounded-xl border border-dashed px-4 py-5 text-center transition-colors',
                    isDragging
                      ? 'border-brand bg-brand-soft/50'
                      : 'border-line-strong bg-surface/40',
                  )}
                >
                  <UploadCloud className="mx-auto h-5 w-5 text-brand" aria-hidden="true" />
                  <p className="mt-2 text-xs text-ink-muted">Drop documents here, or</p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-hover"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Choose files
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.html,.htm,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>

                {isUploading ? (
                  <ul className="space-y-2" aria-live="polite">
                    {uploadingFiles.map((name) => (
                      <li
                        key={name}
                        className="rounded-xl border border-line bg-surface/50 px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <Spinner size="sm" className="text-brand" />
                          <span className="min-w-0 flex-1 truncate text-xs text-ink">{name}</span>
                          <span className="text-[10px] text-ink-subtle">Uploading</span>
                        </div>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-hover">
                          <div className="h-full w-1/3 animate-progress rounded-full bg-brand" />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {uploadError ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5"
                  >
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
                    <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-danger">
                      {uploadError}
                    </p>
                    {onRetryUpload ? (
                      <button
                        type="button"
                        onClick={onRetryUpload}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-danger underline-offset-2 hover:underline"
                      >
                        Retry
                      </button>
                    ) : null}
                    {onDismissUploadError ? (
                      <button
                        type="button"
                        onClick={onDismissUploadError}
                        aria-label="Dismiss upload error"
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-danger/80 hover:bg-danger/10 hover:text-danger"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {availableFiles.length > 0 ? (
                  <div>
                    <p className="mb-1.5 px-1 text-[11px] font-medium tracking-wide text-ink-subtle uppercase">
                      Your documents
                    </p>
                    <ul className="divide-y divide-line/60 overflow-hidden rounded-xl border border-line/70 bg-surface/30">
                      {availableFiles.map((file) => {
                        const isReindexing = reindexingIds[file.id] === true
                        return (
                          <li key={file.id} className="flex items-center gap-2.5 px-3 py-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-raised text-ink-muted">
                              <FileText className="h-4 w-4" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs text-ink" title={file.name}>
                                {file.name}
                              </span>
                              <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-subtle">
                                <StatusDot status={file.status} />
                                {isReindexing ? 'Reindexing' : statusLabel(file.status)}
                              </span>
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                              {onReindexDocument ? (
                                <button
                                  type="button"
                                  onClick={() => onReindexDocument(file.id)}
                                  disabled={isReindexing}
                                  aria-label={`Reindex ${file.name}`}
                                  title="Reindex document"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-subtle transition-colors hover:bg-surface-hover hover:text-ink disabled:cursor-wait disabled:opacity-60"
                                >
                                  <RefreshCw
                                    className={cn('h-3.5 w-3.5', isReindexing && 'animate-spin')}
                                    aria-hidden="true"
                                  />
                                </button>
                              ) : null}
                              {onDeleteServerDocument ? (
                                confirmDeleteId === file.id ? (
                                  <span className="flex items-center gap-0.5">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onDeleteServerDocument(file.id)
                                        setConfirmDeleteId(null)
                                      }}
                                      className="rounded px-1.5 py-1 text-[10px] font-semibold text-danger hover:bg-danger-soft"
                                    >
                                      Delete
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteId(null)}
                                      aria-label="Cancel delete"
                                      className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-subtle hover:bg-surface-hover hover:text-ink"
                                    >
                                      <X className="h-3 w-3" aria-hidden="true" />
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(file.id)}
                                    aria-label={`Delete ${file.name}`}
                                    title="Delete document"
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-subtle transition-colors hover:bg-danger-soft hover:text-danger"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                )
                              ) : null}
                              {onAttachExisting ? (
                                <button
                                  type="button"
                                  onClick={() => onAttachExisting(file.id)}
                                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-[11px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-hover"
                                >
                                  <Plus className="h-3 w-3" aria-hidden="true" />
                                  Attach
                                </button>
                              ) : null}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ) : null}

                <div>
                  <p className="mb-1.5 px-1 text-[11px] font-medium tracking-wide text-ink-subtle uppercase">
                    Attached to this conversation
                  </p>
                  {totalAttached === 0 ? (
                    <p className="rounded-xl border border-line/70 bg-surface/30 px-3 py-4 text-center text-xs text-ink-subtle">
                      No documents attached yet.
                    </p>
                  ) : (
                    <ul className="divide-y divide-line/60 overflow-hidden rounded-xl border border-line/70 bg-surface/30">
                      {attachedFiles.map((file) => {
                        const isError =
  file.status === 'failed' || file.status === 'error' || file.status === 'rejected'
                        return (
                          <li
                            key={file.id}
                            className="flex items-center gap-2.5 px-3 py-2.5"
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-raised text-ink-muted">
                              <FileText className="h-4 w-4" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs text-ink" title={file.name}>
                                {file.name}
                              </span>
                              <span
                                className={cn(
                                  'mt-0.5 flex items-center gap-1.5 text-[10px]',
                                  isError ? 'text-danger' : 'text-ink-subtle',
                                )}
                              >
                                <StatusDot status={file.status} />
                                {statusLabel(file.status)}
                              </span>
                            </span>
                            {onRemoveAttached ? (
                              <button
                                type="button"
                                onClick={() => onRemoveAttached(file.id)}
                                aria-label={`Remove ${file.name}`}
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition-colors hover:bg-danger-soft hover:text-danger"
                              >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>

              <p className="border-t border-line/60 px-4 py-2.5 text-[10px] leading-relaxed text-ink-subtle">
                Files stay attached to this conversation. Answers are grounded in processed
                documents.
              </p>
            </div>
          ) : null}

          <div
            className={cn(
              'rounded-3xl border border-line-strong bg-surface p-4 shadow-[0_24px_60px_-32px_rgba(0,0,0,0.9)] transition-colors sm:p-4',
              'focus-within:border-brand/45',
              disabled && 'opacity-70',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={toggleAttach}
                aria-expanded={showAttach}
                aria-controls="document-panel"
                className="inline-flex min-w-0 items-center gap-1.5 rounded-lg text-xs font-medium text-ink-muted transition-colors hover:text-ink"
              >
                <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">Add Doc ({totalAttached})</span>
              </button>

              <div className="flex shrink-0 items-center gap-1.5" aria-live="polite">
                {isUploading ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-raised/60 px-2 py-0.5 text-[10px] text-ink-muted">
                    <Spinner size="sm" />
                    Uploading
                  </span>
                ) : allReady ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-success/25 bg-success-soft px-2 py-0.5 text-[10px] font-medium text-success">
                    <Check className="h-3 w-3" aria-hidden="true" />
                    Ready
                  </span>
                ) : hasFailed ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-danger/25 bg-danger-soft px-2 py-0.5 text-[10px] font-medium text-danger">
                    <AlertCircle className="h-3 w-3" aria-hidden="true" />
                    Needs attention
                  </span>
                ) : isProcessing ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-raised/60 px-2 py-0.5 text-[10px] text-ink-muted">
                    <StatusDot status="processing" />
                    Processing
                  </span>
                ) : isQueued ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-raised/60 px-2 py-0.5 text-[10px] text-ink-muted">
                    <StatusDot status="queued" />
                    Pending
                  </span>
                ) : null}
              </div>
            </div>

            {totalAttached > 0 ? (
              <div className="mt-3 flex max-w-full flex-wrap gap-2">
                {attachedFiles.map((file) => {
                  const isError =
  file.status === 'failed' || file.status === 'error' || file.status === 'rejected'
                  return (
                    <span
                      key={file.id}
                      className={cn(
                        'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] text-ink',
                        isError ? 'border-danger/35 bg-danger-soft' : 'border-line bg-surface-raised/70',
                      )}
                      title={`${file.name} Â· ${statusLabel(file.status)}`}
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
                      <span className="min-w-0 max-w-[13rem] truncate sm:max-w-[18rem]">
                        {file.name}
                      </span>
                      <StatusDot status={file.status} />
                      {onRemoveAttached ? (
                        <button
                          type="button"
                          onClick={() => onRemoveAttached(file.id)}
                          className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-hover hover:text-ink"
                          aria-label={`Remove ${file.name}`}
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      ) : null}
                    </span>
                  )
                })}
              </div>
            ) : null}

            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              placeholder="Ask something about your documents..."
              aria-label="Message"
              className={cn(
                'scrollbar-none mt-3 max-h-[220px] w-full resize-none bg-transparent px-0.5 py-1 text-[15px] leading-relaxed text-ink outline-none',
                'placeholder:text-ink-subtle',
              )}
            />

            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={toggleAttach}
                aria-label="Add documents"
                aria-expanded={showAttach}
                aria-controls="document-panel"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface-raised/70 text-ink-muted transition-colors hover:border-line-strong hover:bg-surface-hover hover:text-ink"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>

              {isStreaming ? (
                <button
                  type="button"
                  onClick={onStop}
                  aria-label="Stop generating"
                  title="Stop generating"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-line-strong bg-surface-raised text-ink transition-colors hover:bg-surface-hover"
                >
                  <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSend}
                  disabled={disabled || value.trim().length === 0 || charactersLeft < 0}
                  aria-label="Send message"
                  title="Send message"
                  className={cn(
                    'inline-flex h-10 w-10 items-center justify-center rounded-2xl transition-all duration-150',
                    'disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-ink-subtle disabled:shadow-none',
                    value.trim().length > 0 && charactersLeft >= 0
                      ? 'bg-brand text-[#17131f] shadow-[0_10px_24px_-10px_var(--color-brand-glow)] hover:bg-brand-strong'
                      : 'bg-surface-raised text-ink-subtle',
                  )}
                >
                  <ArrowUp className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

