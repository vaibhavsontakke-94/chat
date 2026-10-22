import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Cpu } from 'lucide-react'
import type { ModelOption } from '../../types/chat'
import { cn } from '../../lib/cn'
import { Spinner } from '../ui/Spinner'

export interface ModelSelectorProps {
  models: ModelOption[]
  activeModel: string | null
  onSelect: (model: string) => void
  isLoading?: boolean
  isConfigured?: boolean
  disabled?: boolean
}

export function ModelSelector({
  models,
  activeModel,
  onSelect,
  isLoading = false,
  isConfigured = true,
  disabled = false,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const label = activeModel ?? (isConfigured ? 'Select model' : 'No model configured')

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Model: ${label}`}
        className={cn(
          'inline-flex h-8 max-w-[13rem] items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2.5',
          'text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {isLoading ? (
          <Spinner size="sm" />
        ) : (
          <Cpu className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 z-50 mt-2 w-72 animate-pop overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-2xl"
        >
          <div className="border-b border-line px-3 py-2.5">
            <p className="text-[11px] font-medium tracking-wide text-ink-subtle uppercase">Model</p>
          </div>

          <div className="max-h-72 overflow-y-auto p-1.5">
            {isConfigured && models.length > 0 ? (
              models.map((model) => {
                const isActive = model.id === activeModel
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => {
                      onSelect(model.id)
                      setOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors',
                      isActive ? 'bg-brand-soft' : 'hover:bg-surface-hover',
                    )}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {isActive ? <Check className="h-3.5 w-3.5 text-brand" aria-hidden="true" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-ink">{model.id}</span>
                      <span className="block truncate text-[10px] text-ink-subtle">{model.ownedBy}</span>
                    </span>
                  </button>
                )
              })
            ) : (
              <div className="px-3 py-4 text-center">
                <p className="text-xs text-ink-muted">No models available</p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-subtle">
                  Set <code className="font-mono text-ink-muted">GROQ_API_KEY</code> on the server to
                  connect a provider.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
