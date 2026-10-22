export const SERVER_NAME = 'chat-server'
export const SERVER_VERSION = '0.1.0'

export const DEFAULT_PORT = 3001
export const DEFAULT_GROQ_CHAT_MODEL = 'openai/gpt-oss-20b'

/** Max bytes accepted for a single chat request body. */
export const MAX_BODY_BYTES = 256 * 1024

/** Max characters accepted in a single user message. */
export const MAX_MESSAGE_CHARS = 8_000

/** Max number of messages accepted in one request (history + new). */
export const MAX_HISTORY_MESSAGES = 40

/** Total character budget for the conversation context sent upstream. */
export const MAX_CONTEXT_CHARS = 60_000

/** Max tokens requested from the model for a single completion. */
export const MAX_COMPLETION_TOKENS = 4_096

/** Characters kept from the tail of a message when trimming context. */
export const CONTEXT_TRIM_HEAD_CHARS = 1_000

/** Simple per-IP request budget. */
export const RATE_LIMIT_WINDOW_MS = 60_000
export const RATE_LIMIT_MAX_REQUESTS = 30

/** Model list cache lifetime. */
export const MODEL_CACHE_TTL_MS = 5 * 60_000
