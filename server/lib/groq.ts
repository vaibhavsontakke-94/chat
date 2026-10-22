import type { AppConfig } from '../config.ts'
import { isGroqConfigured } from '../config.ts'
import { ProviderError } from './errors.ts'
import type { ChatRequest } from './validate.ts'

export interface GroqModel {
  id: string
  ownedBy: string
}

export type GroqStreamEvent =
  | { type: 'start'; model: string; id: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; finishReason: string | null; usage: TokenUsage | null }

export interface TokenUsage {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
}

interface ModelCacheEntry {
  expiresAt: number
  models: GroqModel[]
}

const modelCache = new Map<string, ModelCacheEntry>()

/** Models that cannot serve a chat completion. */
const NON_CHAT_PATTERNS = [/embed/i, /whisper/i, /guard/i, /audio/i, /vision/i, /tts/i]

function isChatModel(id: string): boolean {
  return !NON_CHAT_PATTERNS.some((pattern) => pattern.test(id))
}

function authHeaders(config: AppConfig): Record<string, string> {
  if (!config.groqApiKey) {
    throw new ProviderError(
      503,
      'not_configured',
      'No AI provider is configured. Set GROQ_API_KEY on the server.',
    )
  }
  return {
    Authorization: `Bearer ${config.groqApiKey}`,
    'Content-Type': 'application/json',
  }
}

async function mapUpstreamError(response: Response): Promise<ProviderError> {
  let detail = ''
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null) {
      const error = (body as { error?: { message?: unknown } }).error
      if (error && typeof error.message === 'string') detail = error.message
    }
  } catch {
    detail = ''
  }

  if (response.status === 429) {
    return new ProviderError(429, 'rate_limited', 'The model provider is rate limiting requests. Try again shortly.')
  }
  if (response.status === 400) {
    return new ProviderError(
      400,
      'bad_request',
      detail.length > 0 ? `The model provider rejected the request: ${detail}` : 'The model provider rejected the request.',
    )
  }
  if (response.status === 401 || response.status === 403) {
    return new ProviderError(502, 'provider_error', 'The model provider rejected the server credentials.')
  }
  if (response.status >= 500) {
    return new ProviderError(502, 'provider_unavailable', 'The model provider is temporarily unavailable.')
  }
  return new ProviderError(502, 'provider_error', 'The model provider returned an unexpected response.')
}

/**
 * Lists the chat-capable models the configured credentials can access.
 * Results are cached briefly to avoid hammering the provider.
 */
export async function listChatModels(config: AppConfig): Promise<GroqModel[]> {
  const cached = modelCache.get('models')
  if (cached && cached.expiresAt > Date.now()) return cached.models

  const response = await fetch(`${config.groqBaseUrl}/models`, {
    headers: authHeaders(config),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) throw await mapUpstreamError(response)

  const body: unknown = await response.json()
  const list = Array.isArray((body as { data?: unknown }).data) ? (body as { data: unknown[] }).data : []

  const models: GroqModel[] = list
    .filter((entry): entry is { id: string; owned_by?: string } => {
      return typeof entry === 'object' && entry !== null && typeof (entry as { id?: unknown }).id === 'string'
    })
    .filter((entry) => isChatModel(entry.id))
    .map((entry) => ({ id: entry.id, ownedBy: entry.owned_by ?? 'groq' }))

  modelCache.set('models', { expiresAt: Date.now() + config.modelCacheTtlMs, models })
  return models
}

interface GroqChunk {
  id?: string
  model?: string
  choices?: Array<{
    delta?: { content?: string | null }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  } | null
}

/**
 * Streams a chat completion from Groq, yielding normalised events.
 * The caller's abort signal cancels the upstream request.
 */
export async function* streamChatCompletion(
  config: AppConfig,
  request: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<GroqStreamEvent> {
  const model = request.model ?? config.groqChatModel
  const headers = authHeaders(config)

  let response: Response
  try {
    response = await fetch(`${config.groqBaseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new ProviderError(502, 'network_error', 'Could not reach the model provider.')
  }

  if (!response.ok) throw await mapUpstreamError(response)
  if (!response.body) {
    throw new ProviderError(502, 'provider_error', 'The model provider returned an empty stream.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let started = false
  let usage: TokenUsage | null = null
  let finishReason: string | null = null

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.length === 0) continue
        if (!trimmed.startsWith('data:')) continue

        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') continue

        let chunk: GroqChunk
        try {
          chunk = JSON.parse(data) as GroqChunk
        } catch {
          continue
        }

        if (!started) {
          started = true
          yield { type: 'start', model: chunk.model ?? model, id: chunk.id ?? '' }
        }

        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens ?? null,
            completionTokens: chunk.usage.completion_tokens ?? null,
            totalTokens: chunk.usage.total_tokens ?? null,
          }
        }

        const choice = chunk.choices?.[0]
        const text = choice?.delta?.content
        if (typeof text === 'string' && text.length > 0) {
          yield { type: 'delta', text }
        }
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (!started) {
    throw new ProviderError(502, 'provider_error', 'The model provider closed the stream without a response.')
  }

  yield { type: 'done', finishReason, usage }
}

export function isProviderConfigured(config: AppConfig): boolean {
  return isGroqConfigured(config)
}
