import { Sparkles } from 'lucide-react'

export function AuthSplash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-3">
        <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-brand/25 bg-brand-soft text-brand">
          <Sparkles className="h-5 w-5 animate-pulse" aria-hidden="true" />
        </span>
        <span className="text-xs text-ink-subtle">Starting your private session...</span>
      </div>
    </div>
  )
}
