import { KeyRound, Server, SlidersHorizontal, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ModelOption, ProviderInfo } from '../../types/chat'
import { usePreferences } from '../../hooks/usePreferences'
import { useAuth } from '../../lib/auth/AuthProvider'
import { cn } from '../../lib/cn'
import { Badge } from '../ui/Badge'
import { ModelSelector } from '../chat/ModelSelector'
import { Switch } from '../ui/Switch'

export interface SettingsViewProps {
  provider: ProviderInfo
  models: ModelOption[]
  activeModel: string | null
  onSelectModel: (model: string) => void
  documentCount: number
}

function Card({
  title,
  description,
  icon,
  children,
}: {
  title: string
  description?: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface/60">
      <div className="flex items-start gap-3 border-b border-line px-4 py-3.5">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface-raised text-ink-muted">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-ink-subtle">{description}</p> : null}
        </div>
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  )
}

export function SettingsView({
  provider,
  models,
  activeModel,
  onSelectModel,
  documentCount,
}: SettingsViewProps) {
  const { sendOnEnter, showTimestamps, setPreference } = usePreferences()
  const auth = useAuth()
  const isReady = provider.status === 'ready'

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
      <Card
        title="Private session"
        description="Chats and documents are private to this browser."
        icon={<UserRound className="h-4 w-4" aria-hidden="true" />}
      >
        {auth.user ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-ink">Anonymous session</p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-ink-subtle">
                {auth.user.id}
              </p>
            </div>
            <Badge tone="brand">This device</Badge>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-ink-muted">
            {auth.error ??
              (auth.enabled
                ? 'Starting a private session...'
                : 'Authentication is not configured on this deployment.')}
          </p>
        )}
      </Card>

      <Card
        title="AI provider"
        description="Configured on the server. Credentials never reach the browser."
        icon={<Server className="h-4 w-4" aria-hidden="true" />}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={isReady ? 'success' : 'warning'}>
            {isReady ? 'Connected' : 'Not configured'}
          </Badge>
          <span className="text-xs text-ink-muted">
            {isReady ? `Provider: ${provider.provider}` : 'No provider credentials found'}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-xs text-ink-subtle">Active model</span>
          <ModelSelector
            models={models}
            activeModel={activeModel}
            onSelect={onSelectModel}
            isConfigured={isReady}
            disabled={!isReady}
          />
        </div>

        {!isReady ? (
          <div className="mt-4 rounded-xl border border-warning/25 bg-warning-soft px-3.5 py-3 text-[11px] leading-relaxed text-warning">
            <p className="flex items-center gap-1.5 font-medium">
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              Connect a provider
            </p>
            <p className="mt-1.5 text-warning/90">
              Copy <code className="font-mono">.env.example</code> to <code className="font-mono">.env</code>,
              set <code className="font-mono">GROQ_API_KEY</code>, then restart the server. The key is read
              only by the server process.
            </p>
          </div>
        ) : null}
      </Card>

      <Card
        title="Behaviour"
        description="Applies to the chat composer and transcript."
        icon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}
      >
        <div className="space-y-4">
          <Switch
            id="pref-send-on-enter"
            checked={sendOnEnter}
            onCheckedChange={(checked) => setPreference('sendOnEnter', checked)}
            label="Send with Enter"
            description="Off means Enter inserts a new line and Ctrl / ⌘ + Enter sends."
          />
          <Switch
            id="pref-show-timestamps"
            checked={showTimestamps}
            onCheckedChange={(checked) => setPreference('showTimestamps', checked)}
            label="Show timestamps"
            description="Display the time next to every message."
          />
        </div>
      </Card>

      <Card
        title="Session"
        description="Everything below lives in this browser tab."
        icon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}
      >
        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div className={cn('rounded-xl border border-line bg-surface-raised/60 px-3.5 py-3')}>
            <dt className="text-ink-subtle">Attached documents</dt>
            <dd className="mt-1 text-sm text-ink">{documentCount}</dd>
          </div>
          <div className="rounded-xl border border-line bg-surface-raised/60 px-3.5 py-3">
            <dt className="text-ink-subtle">Transport</dt>
            <dd className="mt-1 text-sm text-ink">Server-sent events</dd>
          </div>
        </dl>
      </Card>
    </div>
  )
}
