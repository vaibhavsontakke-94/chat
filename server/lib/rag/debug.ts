type DebugValue = string | number | boolean | null | undefined | Array<string | number>

function isDebugEnabled(): boolean {
  const value = process.env.RAG_DEBUG?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export function shortId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return value.slice(0, 8)
}

/**
 * Emits opt-in development diagnostics. Callers must only pass counts, short
 * ids, dimensions, and scores. Never pass document text, prompts, tokens, or
 * user content.
 */
export function ragDebug(event: string, fields: Record<string, DebugValue> = {}): void {
  if (!isDebugEnabled()) return
  const safe: Record<string, DebugValue> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string') {
      safe[key] = /token|key|secret|content|prompt|text|query|answer|authorization/i.test(key)
        ? '[redacted]'
        : value.slice(0, 80)
    } else if (Array.isArray(value)) {
      safe[key] = value.slice(0, 20)
    } else {
      safe[key] = value
    }
  }
  console.info('[rag]', event, safe)
}

export function ragDebugError(event: string, error: unknown): void {
  if (!isDebugEnabled()) return
  const name = error instanceof Error ? error.name : 'Error'
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : ''
  const message = error instanceof Error ? error.message : String(error)
  console.warn('[rag]', event, {
    name,
    code: code.slice(0, 40),
    message: message.replace(/[\r\n]+/g, ' ').slice(0, 160),
  })
}
