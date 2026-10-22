import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { ArrowUp, FileText, Paperclip, Plus, Square, X } from 'lucide-react'
import { cn } from '../../lib/cn'

export interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  isStreaming: boolean
  sendOnEnter: boolean
  documentCount: number
  onAttach?: () => void
  onAttachFiles?: (files: File[]) => void
  attachedFiles?: Array<{ id: string; name: string; status?: string }>
  onRemoveAttached?: (id: string) => void
  maxChars: number
  disabled?: boolean
  disabledReason?: string
}

const MAX_TEXTAREA_HEIGHT = 220

export function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  isStreaming,
  sendOnEnter,
  documentCount,
  onAttach,
  onAttachFiles,
  attachedFiles = [],
  onRemoveAttached,
  maxChars,
  disabled = false,
  disabledReason,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showAttach, setShowAttach] = useState(false)

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [value])

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

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0 && onAttachFiles) {
      onAttachFiles(files)
    }
    event.target.value = ''
    setShowAttach(false)
  }

  const charactersLeft = maxChars - value.length
  const nearLimit = charactersLeft <= 500

  return (
    <div className="px-4 pb-4 pt-2 sm:px-6 sm:pb-6">
      <div className="mx-auto w-full max-w-3xl">
        {disabled && disabledReason ? (
          <p className="mb-2 rounded-xl border border-warning/25 bg-warning-soft px-3 py-2 text-xs text-warning">
            {disabledReason}
          </p>
        ) : null}

        {attachedFiles.length > 0 ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {attachedFiles.map((f) => (
              <div
                key={f.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink"
                title={f.name}
              >
                <FileText className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />
                <span className="max-w-[160px] truncate">{f.name}</span>
                {onRemoveAttached ? (
                  <button
                    type="button"
                    onClick={() => onRemoveAttached(f.id)}
                    className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-subtle hover:bg-surface-raised hover:text-ink"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mb-2 text-xs text-ink-subtle">No documents attached</p>
        )}

        <div className="relative">
          {showAttach ? (
            <div className="absolute bottom-full mb-2 w-full rounded-2xl border border-line bg-surface p-3 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.9)]">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-ink">Add Doc</p>
                  <p className="text-xs text-ink-muted">
                    {documentCount > 0 ? `Add Doc (${documentCount})` : 'Add Doc (0)'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAttach(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-raised hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mb-2 max-h-40 overflow-y-auto rounded-xl border border-line bg-surface/60 p-2">
                {attachedFiles.length > 0 ? (
                  <ul className="space-y-1">
                    {attachedFiles.map((f) => (
                      <li key={f.id} className="flex items-center justify-between rounded-lg px-2 py-1 text-xs text-ink">
                        <div className="flex min-w-0 items-center gap-2">
                          <FileText className="h-3.5 w-3.5 text-ink-muted" />
                          <span className="truncate">{f.name}</span>
                          {f.status ? <span className="text-[10px] text-ink-subtle">{f.status}</span> : null}
                        </div>
                        {onRemoveAttached ? (
                          <button
                            type="button"
                            onClick={() => onRemoveAttached(f.id)}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-raised hover:text-ink"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-2 py-2 text-xs text-ink-subtle">No documents attached</p>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink hover:bg-surface-raised"
                >
                  <Plus className="h-3.5 w-3.5" /> Select documents
                </button>
                <button
                  type="button"
                  onClick={() => setShowAttach(false)}
                  className="inline-flex items-center rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink hover:bg-surface-raised"
                >
                  Done
                </button>
              </div>
            </div>
          ) : null}

          <div
            className={cn(
              'rounded-2xl border border-line bg-surface/90 p-2 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.9)] transition-colors',
              'focus-within:border-line-strong',
              disabled && 'opacity-60',
            )}
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              placeholder="Send a message…"
              aria-label="Message"
              className={cn(
                'max-h-[220px] w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed text-ink outline-none',
                'placeholder:text-ink-subtle scrollbar-none',
              )}
            />

            <div className="flex items-center gap-2 px-1 pb-0.5">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.txt,.md,.docx,.doc,.csv,.json,.html,.htm,.ppt,.pptx,.xls,.xlsx"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => {
                  setShowAttach((v) => !v)
                }}
                disabled={disabled}
                aria-label="Add Doc"
                title="Add Doc"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{documentCount > 0 ? `Add Doc (${documentCount})` : 'Add Doc'}</span>
                <span className="sm:hidden">Add Doc</span>
                {documentCount > 0 ? (
                  <span className="rounded-full bg-brand-soft px-1.5 text-[10px] text-brand sm:hidden">{documentCount}</span>
                ) : null}
              </button>

            <div className="flex min-w-0 flex-1 items-center gap-2" />

            <span
              className={cn(
                'ml-auto hidden text-[11px] tabular-nums sm:inline',
                nearLimit ? 'text-warning' : 'text-ink-subtle',
              )}
            >
              {charactersLeft < 0 ? `${-charactersLeft} over limit` : `${charactersLeft}`}
            </span>

            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop generating"
                title="Stop generating"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface-raised text-ink transition-colors hover:bg-surface-hover"
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
                  'inline-flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150',
                  'disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-ink-subtle',
                  value.trim().length > 0 && charactersLeft >= 0
                    ? 'bg-brand text-white shadow-[0_8px_20px_-8px_var(--color-brand-glow)] hover:bg-brand-strong'
                    : 'bg-surface-raised text-ink-subtle',
                )}
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <p className="mt-2 px-1 text-[11px] text-ink-subtle">
          {sendOnEnter
            ? 'Enter to send · Shift + Enter for a new line'
            : 'Ctrl / ⌘ + Enter to send'}
          {' · Streaming responses from the server'}
        </p>
      </div>
    </div>
  )
}
