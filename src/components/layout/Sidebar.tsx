import { Clock, FileText, Plus, Settings, Sparkles, Trash2, X } from 'lucide-react'
import type { ChatSession, ProviderInfo } from '../../types/chat'
import { cn } from '../../lib/cn'
import { formatRelativeTime } from '../../lib/format'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'

export type AppView = 'chat' | 'documents' | 'settings'

export interface SidebarProps {
  sessions: ChatSession[]
  activeSessionId: string
  view: AppView
  onViewChange: (view: AppView) => void
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onNewChat: () => void
  documentCount: number
  provider: ProviderInfo
  isOpen: boolean
  onClose: () => void
}

const NAV_ITEMS: Array<{ id: AppView; label: string; icon: typeof Clock }> = [
  { id: 'chat', label: 'Chat', icon: Clock },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export function Sidebar({
  sessions,
  activeSessionId,
  view,
  onViewChange,
  onSelectSession,
  onDeleteSession,
  onNewChat,
  documentCount,
  provider,
  isOpen,
  onClose,
}: SidebarProps) {
  return (
    <aside
      className={cn(
        'flex h-full w-[17rem] shrink-0 flex-col border-r border-line bg-canvas-raised/80 backdrop-blur-xl',
        'transition-transform duration-200 lg:translate-x-0',
        isOpen ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/15 text-brand">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </div>
        <span className="flex-1 text-sm font-semibold tracking-tight text-ink">chat</span>
        <IconButton label="Close sidebar" icon={<X className="h-4 w-4" aria-hidden="true" />} onClick={onClose} className="lg:hidden" />
      </div>

      <div className="px-3 pb-3">
        <Button
          variant="primary"
          className="w-full justify-start"
          leadingIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
          onClick={onNewChat}
        >
          New chat
        </Button>
      </div>

      <nav className="px-3 pb-2">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = view === item.id
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onViewChange(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-surface-raised text-ink'
                      : 'text-ink-muted hover:bg-surface-raised/60 hover:text-ink',
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.id === 'documents' && documentCount > 0 ? (
                    <span className="rounded-full bg-surface-raised px-1.5 text-[10px] text-ink-muted">
                      {documentCount}
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-line/70">
        <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
          <h2 className="text-[11px] font-medium tracking-wide text-ink-subtle uppercase">Chat history</h2>
          <span className="text-[11px] text-ink-subtle">{sessions.length}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {sessions.length === 0 ? (
            <p className="px-3 py-4 text-xs leading-relaxed text-ink-subtle">
              No conversations yet. Start a new chat to see it here.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {sessions.map((session) => {
                const isActive = session.id === activeSessionId && view === 'chat'
                return (
                  <li key={session.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => onSelectSession(session.id)}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2 pr-8 text-left transition-colors',
                        isActive ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:bg-surface-raised/60 hover:text-ink',
                      )}
                    >
                      <span className="w-full truncate text-[13px]">{session.title}</span>
                      <span className="text-[10px] text-ink-subtle">
                        {session.messages.length > 0
                          ? `${session.messages.length} message${session.messages.length === 1 ? '' : 's'} · ${formatRelativeTime(session.updatedAt)}`
                          : formatRelativeTime(session.createdAt)}
                      </span>
                    </button>
                    <IconButton
                      label={`Delete ${session.title}`}
                      size="sm"
                      icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => onDeleteSession(session.id)}
                      className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="border-t border-line/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              provider.status === 'ready' ? 'bg-success' : 'bg-warning',
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-subtle">
            {provider.status === 'ready'
              ? `${provider.provider} · ${provider.model}`
              : 'Provider not configured'}
          </span>
        </div>
      </div>
    </aside>
  )
}
