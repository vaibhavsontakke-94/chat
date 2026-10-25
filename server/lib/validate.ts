import {
  MAX_COMPLETION_TOKENS,
  MAX_CONTEXT_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS,
  CONTEXT_TRIM_HEAD_CHARS,
} from '../constants.ts'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export const ROLES = ['system', 'user', 'assistant'] as const
export type Role = (typeof ROLES)[number]

export interface WireMessage {
  role: Role
  content: string
}

export interface ChatRequest {
  model: string | null
  messages: WireMessage[]
  temperature: number
  maxTokens: number
  reasoningEffort?: 'low' | 'medium' | 'high'
}

export interface ValidationError {
  message: string
  field: string
}

export type ValidationResult =
  | { ok: true; value: ChatRequest }
  | { ok: false; error: ValidationError }

const MAX_TEMPERATURE = 2

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/**
 * Validates an untrusted chat request body.
 * Every field is checked and clamped/typed before it reaches the provider.
 */
export function validateChatRequest(
  input: unknown,
  options: { fallbackModel: string },
): ValidationResult {
  if (!isRecord(input)) {
    return { ok: false, error: { field: 'body', message: 'Request body must be a JSON object.' } }
  }

  if (!Array.isArray(input.messages)) {
    return { ok: false, error: { field: 'messages', message: '`messages` must be an array.' } }
  }

  if (input.messages.length === 0) {
    return { ok: false, error: { field: 'messages', message: '`messages` must contain at least one message.' } }
  }

  if (input.messages.length > MAX_HISTORY_MESSAGES) {
    return {
      ok: false,
      error: {
        field: 'messages',
        message: `Too many messages. The limit is ${MAX_HISTORY_MESSAGES}.`,
      },
    }
  }

  const messages: WireMessage[] = []

  for (const [index, entry] of input.messages.entries()) {
    if (!isRecord(entry)) {
      return { ok: false, error: { field: `messages[${index}]`, message: 'Each message must be an object.' } }
    }
    if (!isRole(entry.role)) {
      return {
        ok: false,
        error: { field: `messages[${index}].role`, message: 'Role must be one of: system, user, assistant.' },
      }
    }
    if (typeof entry.content !== 'string') {
      return {
        ok: false,
        error: { field: `messages[${index}].content`, message: 'Message content must be a string.' },
      }
    }

    const content = entry.content.trim()
    if (content.length === 0) {
      return {
        ok: false,
        error: { field: `messages[${index}].content`, message: 'Message content must not be empty.' },
      }
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      return {
        ok: false,
        error: {
          field: `messages[${index}].content`,
          message: `Message is too long. The limit is ${MAX_MESSAGE_CHARS} characters.`,
        },
      }
    }

    messages.push({ role: entry.role, content })
  }

  const lastRole = messages[messages.length - 1]?.role
  if (lastRole !== 'user' && lastRole !== 'assistant') {
    return {
      ok: false,
      error: { field: 'messages', message: 'The conversation must end with a user or assistant message.' },
    }
  }

  const model = typeof input.model === 'string' && input.model.trim().length > 0
    ? input.model.trim()
    : options.fallbackModel

  const temperature = typeof input.temperature === 'number' && Number.isFinite(input.temperature)
    ? Math.min(Math.max(input.temperature, 0), MAX_TEMPERATURE)
    : 0.7

  const maxTokens = typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens)
    ? Math.min(Math.max(Math.trunc(input.maxTokens), 1), MAX_COMPLETION_TOKENS)
    : MAX_COMPLETION_TOKENS

  return {
    ok: true,
    value: {
      model,
      messages: trimContext(messages),
      temperature,
      maxTokens,
    },
  }
}

/**
 * Keeps the conversation inside a character budget by dropping the oldest
 * messages first and trimming the head of any single oversized message.
 */
export function trimContext(messages: WireMessage[], budget = MAX_CONTEXT_CHARS): WireMessage[] {
  const total = messages.reduce((sum, message) => sum + message.content.length, 0)
  if (total <= budget) return messages

  const system = messages.filter((message) => message.role === 'system')
  const rest = messages.filter((message) => message.role !== 'system')

  const kept: WireMessage[] = []
  let used = system.reduce((sum, message) => sum + message.content.length, 0)

  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const message = rest[i]
    if (!message) continue
    const cost = message.content.length
    if (used + cost > budget) {
      if (kept.length === 0) {
        const trimmed: WireMessage = {
          ...message,
          content: message.content.slice(-Math.min(budget, CONTEXT_TRIM_HEAD_CHARS * 4)),
        }
        used += trimmed.content.length
        kept.unshift(trimmed)
      }
      break
    }
    used += cost
    kept.unshift(message)
  }

  return [...system, ...kept]
}
