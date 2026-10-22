import { cn } from '../../lib/cn'

export type SwitchSize = 'sm' | 'md'

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
  size?: SwitchSize
  /** Renders the label next to the control instead of above it. */
  inline?: boolean
  id?: string
  className?: string
}

const TRACKS: Record<SwitchSize, string> = {
  sm: 'h-5 w-9',
  md: 'h-6 w-11',
}

const KNOBS: Record<SwitchSize, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4.5 w-4.5',
}

const KNOB_OFFSET: Record<SwitchSize, string> = {
  sm: 'translate-x-4',
  md: 'translate-x-5',
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  size = 'md',
  inline = false,
  id,
  className,
}: SwitchProps) {
  const control = (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label ?? undefined}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200',
        'disabled:cursor-not-allowed disabled:opacity-45',
        TRACKS[size],
        checked ? 'bg-brand' : 'bg-line-strong',
        className,
      )}
    >
      <span
        className={cn(
          'absolute left-1 rounded-full bg-white shadow-sm transition-transform duration-200',
          KNOBS[size],
          checked ? KNOB_OFFSET[size] : 'translate-x-0',
        )}
      />
    </button>
  )

  if (!label) return control

  if (inline) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <label htmlFor={id} className="cursor-pointer text-xs text-ink-muted select-none">
          {label}
        </label>
        {control}
      </div>
    )
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs text-ink-subtle">{description}</p> : null}
      </div>
      {control}
    </div>
  )
}
