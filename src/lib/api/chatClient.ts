import type { ModelsResponse, ProviderInfo, TokenUsage } from '../../types/chat'

export class ChatApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code = 'request_failed', status = 0) {
    super(message)
    this.name = 'ChatApiError'
    this.code = code
    this.status = status
  }
}

export interface WireMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamChatInput {
  messages: WireMessage[]
  model: string | null
  signal: AbortSignal
  rag?: boolean
  documentId?: string | null
}

export interface StreamChatResult {
  model: string
  finishReason: string | null
  usage: TokenUsage | null
}

export interface StreamChatHandlers {
  onStart?: (info: { model: string; id: string }) => void
  onDelta: (text: string) => void
  onDone: (result: StreamChatResult) => void
  onCitations?: (citations: any[]) => void
}

interface SseEvent {
  name: string
  data: unknown
}

function parseBlock(block: string): SseEvent | null {
  let name = 'message'
  const dataLines: string[] = []

  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      name = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }

  if (dataLines.length === 0) return null

  const raw = dataLines.join('\n')
  try {
    return { name, data: JSON.parse(raw) as unknown }
  } catch {
    return { name, data: raw }
  }
}

async function readSse(response: Response, onEvent: (event: SseEvent) => void): Promise<void> {
  if (!response.body) {
    throw new ChatApiError('The server returned an empty response stream.', 'empty_stream')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const event = parseBlock(block)
        if (event) onEvent(event)
        boundary = buffer.indexOf('\n\n')
      }
    }

    const trailing = buffer.trim()
    if (trailing.length > 0) {
      const event = parseBlock(trailing)
      if (event) onEvent(event)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }
}

async function toApiError(response: Response): Promise<ChatApiError> {
  try {
    const body: unknown = await response.json()
    const error = (body as { error?: { message?: string; code?: string } }).error
    if (error && typeof error.message === 'string') {
      return new ChatApiError(error.message, error.code ?? 'request_failed', response.status)
    }
  } catch {
    // fall through to the generic message
  }
  return new ChatApiError(
    `Request failed with status ${response.status}.`,
    'request_failed',
    response.status,
  )
}

/** Streams an assistant reply. Rejects with {@link ChatApiError} on failure. */
export async function streamChat(
  input: StreamChatInput,
  handlers: StreamChatHandlers,
): Promise<StreamChatResult> {
  let response: Response

  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sb-access-token') : null
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    // Try to get token from supabase session if available
    try {
      const supa = (window as any).__SUPABASE__?.auth?.getSession
      // fallback: not easily accessible; rely on header if set elsewhere - but better to read from storage
    } catch {}
    // Also check common supabase key
    if (!token) {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.includes('auth-token')) {
          try {
            const v = JSON.parse(localStorage.getItem(k) || '{}')
            if (v?.access_token) { headers['Authorization'] = `Bearer ${v.access_token}`; break }
          } catch {}
        }
      }
    } else {
      headers['Authorization'] = `Bearer ${token}`
    }
    response = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: input.messages,
        model: input.model,
        rag: input.rag,
        documentId: input.documentId,
      }),
      signal: input.signal,
    })
  } catch (error) {
    if (input.signal.aborted) throw error
    throw new ChatApiError('Could not reach the server. Check that it is running.', 'network_error')
  }

  if (!response.ok) {
    throw await toApiError(response)
  }

  let model = input.model ?? ''
  let finishReason: string | null = null
  let usage: TokenUsage | null = null
  let done = false

  await readSse(response, (event) => {
    const data = (event.data ?? {}) as Record<string, unknown>

    switch (event.name) {
      case 'start':
        model = typeof data.model === 'string' ? data.model : model
        handlers.onStart?.({ model, id: typeof data.id === 'string' ? data.id : '' })
        break
      case 'delta':
        if (typeof data.text === 'string') handlers.onDelta(data.text)
        break
      case 'done':
        done = true
        finishReason = typeof data.finishReason === 'string' ? data.finishReason : null
        usage = (data.usage as TokenUsage | undefined) ?? null
        break
      case 'citations':
        if (Array.isArray(data.citations)) handlers.onCitations?.(data.citations)
        break
      case 'error':
        throw new ChatApiError(
          typeof data.message === 'string' ? data.message : 'The provider returned an error.',
          typeof data.code === 'string' ? data.code : 'provider_error',
        )
      default:
        break
    }
  })

  if (!done) {
    throw new ChatApiError('The response stream ended unexpectedly.', 'stream_incomplete')
  }

  const result: StreamChatResult = { model, finishReason, usage }
  handlers.onDone(result)
  return result
}

/** Loads the models the server credentials can access. */
export async function fetchModels(signal?: AbortSignal): Promise<ModelsResponse> {
  const response = await fetch('/api/models', { signal })
  if (!response.ok) throw await toApiError(response)
  return (await response.json()) as ModelsResponse
}

/** Reads the server-side provider status (never exposes credentials). */
export async function fetchProviderStatus(signal?: AbortSignal): Promise<ProviderInfo> {
  const response = await fetch('/api/health', { signal })
  if (!response.ok) throw await toApiError(response)

  const body = (await response.json()) as {
    provider?: string
    status?: string
    model?: string
  }

  const configured = body.provider === 'groq'
  return {
    status: configured ? 'ready' : 'unconfigured',
    provider: body.provider ?? 'unknown',
    model: body.model ?? '',
  }
}
