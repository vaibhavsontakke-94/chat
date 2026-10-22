import { cn } from '../../lib/cn'

export interface TypingIndicatorProps {
  className?: string
  label?: string
}

/** Three-dot indicator shown while the assistant's first tokens are pending. */
export function TypingIndicator({ className, label = 'Assistant is thinking' }: TypingIndicatorProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} aria-label={label} role="status">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-1.5 w-1.5 animate-blink rounded-full bg-ink-subtle"
          style={{ animationDelay: `${index * 140}ms` }}
        />
      ))}
    </span>
  )
}
