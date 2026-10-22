import { useEffect, useRef, type ChangeEvent, type KeyboardEvent } from 'react'
import { ArrowUp, Paperclip, Square } from 'lucide-react'
import { cn } from '../../lib/cn'
import { Switch } from '../ui/Switch'

export interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  isStreaming: boolean
  sendOnEnter: boolean
  isRagEnabled: boolean
  onRagChange: (enabled: boolean) => void
  documentCount: number
  onAttach: () => void
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
  isRagEnabled,
  onRagChange,
  documentCount,
  onAttach,
  maxChars,
  disabled = false,
  disabledReason,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
            placeholder={isRagEnabled ? 'Ask a question about your documents…' : 'Send a message…'}
            aria-label="Message"
            className={cn(
              'max-h-[220px] w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed text-ink outline-none',
              'placeholder:text-ink-subtle scrollbar-none',
            )}
          />

          <div className="flex items-center gap-2 px-1 pb-0.5">
            <button
              type="button"
              onClick={onAttach}
              disabled={disabled}
              aria-label="Attach documents"
              title="Attach documents"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Attach</span>
              {documentCount > 0 ? (
                <span className="rounded-full bg-brand-soft px-1.5 text-[10px] text-brand">{documentCount}</span>
              ) : null}
            </button>

            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Switch
                size="sm"
                inline
                checked={isRagEnabled}
                onCheckedChange={onRagChange}
                disabled={disabled}
                label="Chat with Documents"
                className="min-w-0"
              />
            </div>

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
