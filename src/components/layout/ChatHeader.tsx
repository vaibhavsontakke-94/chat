import { Menu, Plus, Sparkles } from 'lucide-react'
import { IconButton } from '../ui/IconButton'

export interface ChatHeaderProps {
  onOpenSidebar: () => void
  onNewChat: () => void
  isSidebarOpen: boolean
}

export function ChatHeader({ onOpenSidebar, onNewChat, isSidebarOpen }: ChatHeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2.5 border-b border-line/60 px-3 sm:gap-3 sm:px-5">
      <IconButton
        label={isSidebarOpen ? 'Collapse sidebar' : 'Open sidebar'}
        icon={<Menu className="h-4 w-4" aria-hidden="true" />}
        onClick={onOpenSidebar}
        aria-expanded={isSidebarOpen}
        aria-controls="app-sidebar"
        className="h-8 w-8 rounded-lg"
      />

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="truncate text-[15px] font-semibold tracking-tight text-ink">Nyra AI</span>
      </div>

      <button
        type="button"
        onClick={onNewChat}
        aria-label="Start a new chat"
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface-raised px-3 text-xs font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-hover"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">New chat</span>
      </button>
    </header>
  )
}
