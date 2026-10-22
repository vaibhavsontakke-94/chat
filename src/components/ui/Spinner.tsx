import { cn } from '../../lib/cn'

export interface SpinnerProps {
  className?: string
  size?: 'sm' | 'md'
}

export function Spinner({ className, size = 'md' }: SpinnerProps) {
  return (
    <svg
      className={cn('animate-spin', size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z"
      />
    </svg>
  )
}
