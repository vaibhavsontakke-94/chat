import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-white shadow-[0_8px_24px_-8px_var(--color-brand-glow)] hover:bg-brand-strong active:scale-[0.98]',
  secondary: 'bg-surface-raised text-ink hover:bg-surface-hover border border-line',
  ghost: 'text-ink-muted hover:text-ink hover:bg-surface-raised',
  outline: 'border border-line-strong text-ink hover:bg-surface-raised',
  danger: 'bg-danger-soft text-danger border border-danger/25 hover:bg-danger/15',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-sm gap-2 rounded-xl',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  leadingIcon,
  trailingIcon,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center font-medium whitespace-nowrap transition-all duration-150',
        'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  )
}
