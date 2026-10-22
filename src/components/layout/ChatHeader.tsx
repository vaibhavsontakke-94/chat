import { Menu, Plus } from 'lucide-react'
import type { ModelOption, ProviderInfo } from '../../types/chat'
import { cn } from '../../lib/cn'
import { IconButton } from '../ui/IconButton'
import { ModelSelector } from '../chat/ModelSelector'

export interface ChatHeaderProps {
  title: string
  provider: ProviderInfo
  models: ModelOption[]
  activeModel: string | null
  onSelectModel: (model: string) => void
  isLoadingModels: boolean
  onOpenSidebar: () => void
  onNewChat: () => void
}

export function ChatHeader({
  title,
  provider,
  models,
  activeModel,
  onSelectModel,
  isLoadingModels,
  onOpenSidebar,
  onNewChat,
}: ChatHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-canvas/85 px-3 backdrop-blur-xl sm:px-4">
      <IconButton
        label="Open sidebar"
        icon={<Menu className="h-4 w-4" aria-hidden="true" />}
        onClick={onOpenSidebar}
        className="lg:hidden"
      />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="truncate text-sm font-medium text-ink">{title}</h1>
        <span
          className={cn(
            'hidden items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] sm:inline-flex',
            provider.status === 'ready'
              ? 'border-success/25 bg-success-soft text-success'
              : 'border-warning/25 bg-warning-soft text-warning',
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          {provider.status === 'ready' ? 'Connected' : 'Setup required'}
        </span>
      </div>

      <ModelSelector
        models={models}
        activeModel={activeModel}
        onSelect={onSelectModel}
        isLoading={isLoadingModels}
        isConfigured={provider.status === 'ready'}
        disabled={provider.status !== 'ready'}
      />

      <IconButton
        label="New chat"
        icon={<Plus className="h-4 w-4" aria-hidden="true" />}
        onClick={onNewChat}
        className="sm:hidden"
      />
    </header>
  )
}
