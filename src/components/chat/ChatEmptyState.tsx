import { ArrowRight, Compass, FileText, MessageSquare, Sparkles } from 'lucide-react'
import { cn } from '../../lib/cn'

export interface ChatEmptyStateProps {
  onPickPrompt: (prompt: string) => void
  hasDocuments: boolean
}

const PROMPTS = [
  {
    icon: MessageSquare,
    title: 'Explain a concept',
    prompt: 'Explain how retrieval-augmented generation works, in simple terms.',
  },
  {
    icon: Compass,
    title: 'Plan something',
    prompt: 'Give me a concise plan to learn a new programming language in two weeks.',
  },
  {
    icon: FileText,
    title: 'Summarise a topic',
    prompt: 'Summarise the key trade-offs between SQL and NoSQL databases.',
  },
]

export function ChatEmptyState({ onPickPrompt, hasDocuments }: ChatEmptyStateProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-2 py-10 text-center sm:py-16">
      <div className="relative mb-6">
        <div className="absolute inset-0 -z-10 h-16 w-16 rounded-3xl bg-brand-glow blur-2xl" />
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface-raised text-brand shadow-lg">
          <Sparkles className="h-6 w-6" aria-hidden="true" />
        </div>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        What can I help you with?
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
        {hasDocuments
          ? 'Your documents are ready. Ask a question and I will ground the answer in them.'
          : 'Start a conversation. Responses stream in from the model configured on the server.'}
      </p>

      <div className="mt-8 grid w-full gap-2.5 sm:grid-cols-3">
        {PROMPTS.map((prompt) => (
          <button
            key={prompt.title}
            type="button"
            onClick={() => onPickPrompt(prompt.prompt)}
            className={cn(
              'group flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 text-left',
              'transition-all duration-150 hover:border-line-strong hover:bg-surface-raised',
            )}
          >
            <prompt.icon className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-sm text-ink-muted group-hover:text-ink">
              {prompt.title}
            </span>
            <ArrowRight
              className="h-3.5 w-3.5 shrink-0 text-ink-subtle opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </div>
  )
}
