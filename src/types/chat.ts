export interface Citation {
  document_id?: string | null
  filename: string
  page_number: number | null
  chunk_id: string
  similarity: number
}

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
  retried?: boolean
  citations?: Citation[]
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  /** Server-side conversation id once the session is persisted. */
  remoteId?: string
  /** Older messages exist on the server. */
  hasMoreMessages?: boolean
  /** Cursor for the next older page (ISO timestamp). */
  oldestMessageCursor?: string | null
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
