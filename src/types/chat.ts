export type MessageRole = 'user' | 'assistant'

export type MessageStatus = 'complete' | 'streaming' | 'error' | 'cancelled'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: number
  status: MessageStatus
  error?: string
  model?: string
  /** True when the message was produced by a retry of an earlier failed attempt. */
  retried?: boolean
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

export type ChatStatus = 'idle' | 'streaming'

export interface TokenUsage {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
}

export interface ModelOption {
  id: string
  ownedBy: string
}

export interface ModelsResponse {
  configured: boolean
  active: string
  models: ModelOption[]
  error?: string
}

export type ProviderStatus = 'unknown' | 'ready' | 'unconfigured' | 'error'

export interface ProviderInfo {
  status: ProviderStatus
  provider: string
  model: string
  message?: string
}
