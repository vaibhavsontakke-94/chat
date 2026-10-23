import { Sparkles } from 'lucide-react'

export function ChatEmptyState() {
  return (
    <div className="flex h-full min-h-[18rem] animate-fade-in flex-col items-center justify-center px-6 py-12 text-center">
      <div className="relative mb-7 flex h-14 w-14 items-center justify-center">
        <div
          className="absolute inset-0 scale-[1.9] rounded-full bg-brand/20 blur-2xl"
          aria-hidden="true"
        />
        <Sparkles className="relative h-9 w-9 text-brand" aria-hidden="true" />
      </div>

      <h1 className="text-[26px] font-semibold tracking-tight text-ink sm:text-[32px]">
        How can I help you?
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-muted sm:text-[15px]">
        Ask anything or chat with your documents.
      </p>
    </div>
  )
}
