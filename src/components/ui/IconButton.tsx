import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type IconButtonVariant = 'ghost' | 'solid' | 'danger'
export type IconButtonSize = 'sm' | 'md'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required - the button has no visible text. */
  label: string
  icon?: ReactNode
  variant?: IconButtonVariant
  size?: IconButtonSize
  active?: boolean
}

const VARIANTS: Record<IconButtonVariant, string> = {
  ghost: 'text-ink-muted hover:text-ink hover:bg-surface-raised',
  solid: 'bg-surface-raised text-ink border border-line hover:bg-surface-hover',
  danger: 'text-ink-muted hover:text-danger hover:bg-danger-soft',
}

const SIZES: Record<IconButtonSize, string> = {
  sm: 'h-7 w-7 rounded-lg',
  md: 'h-9 w-9 rounded-xl',
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  active = false,
  className,
  type = 'button',
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        active && 'bg-surface-hover text-ink',
        className,
      )}
      {...props}
    >
      {icon ?? children}
    </button>
  )
}
