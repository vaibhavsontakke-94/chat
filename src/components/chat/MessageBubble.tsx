import { AlertTriangle, RotateCcw, Sparkles } from 'lucide-react'
import type { ChatMessage } from '../../types/chat'
import { cn } from '../../lib/cn'
import { formatTime } from '../../lib/format'
import { Button } from '../ui/Button'

export interface MessageBubbleProps {
  message: ChatMessage
  showTimestamp: boolean
  onRetry?: () => void
}

export function MessageBubble({ message, showTimestamp, onRetry }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isStreaming = message.status === 'streaming'
  const isError = message.status === 'error'
  const isCancelled = message.status === 'cancelled'

  return (
    <div className={cn('flex w-full animate-rise gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser ? (
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-raised text-brand">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </div>
      ) : null}

      <div className={cn('flex min-w-0 max-w-[min(46rem,85%)] flex-col gap-1', isUser && 'items-end')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words',
            isUser
              ? 'bg-brand text-white shadow-[0_10px_30px_-12px_var(--color-brand-glow)]'
              : 'border border-line bg-surface text-ink',
            isError && 'border-danger/40 bg-danger-soft',
          )}
        >
          {isError ? (
            <span className="flex items-start gap-2 text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{message.error ?? 'The response could not be generated.'}</span>
            </span>
          ) : null}

          {!isError && message.content.length > 0 ? <span>{message.content}</span> : null}

          {!isError && isStreaming && message.content.length === 0 ? (
            <span className="flex h-5 items-center gap-1.5">
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className="h-1.5 w-1.5 animate-blink rounded-full bg-ink-subtle"
                  style={{ animationDelay: `${index * 140}ms` }}
                />
              ))}
            </span>
          ) : null}

          {isStreaming && message.content.length > 0 ? (
            <span className="ml-0.5 inline-block h-4 w-[2px] animate-blink bg-brand align-text-bottom" />
          ) : null}

          {isCancelled ? (
            <span className="text-xs text-ink-subtle">Generation stopped.</span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 px-1">
          {showTimestamp ? (
            <time
              className="text-[11px] text-ink-subtle"
              dateTime={new Date(message.createdAt).toISOString()}
            >
              {formatTime(message.createdAt)}
            </time>
          ) : null}

          {message.model && !isUser ? (
            <span className="text-[11px] text-ink-subtle">· {message.model}</span>
          ) : null}

          {isError && onRetry ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-danger hover:bg-danger-soft"
              leadingIcon={<RotateCcw className="h-3 w-3" aria-hidden="true" />}
              onClick={onRetry}
            >
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
