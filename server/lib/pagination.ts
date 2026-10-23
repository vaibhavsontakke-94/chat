export interface ListPageParams {
  limit: number
  offset: number
}

export interface MessagePageParams {
  limit: number
  /** ISO timestamp; returns messages strictly older than this cursor. */
  before: string | null
}

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(parsed, max)
}

function parseIsoCursor(value: string | null): string | null {
  if (!value) return null
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return null
  return new Date(time).toISOString()
}

export function parseListParams(
  searchParams: URLSearchParams,
  options: { defaultLimit?: number; maxLimit?: number } = {},
): ListPageParams {
  const max = options.maxLimit ?? MAX_PAGE_SIZE
  return {
    limit: parsePositiveInt(searchParams.get('limit'), options.defaultLimit ?? DEFAULT_PAGE_SIZE, max),
    offset: Math.max(0, parsePositiveInt(searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER)),
  }
}

export function parseMessagePageParams(
  searchParams: URLSearchParams,
  options: { defaultLimit?: number; maxLimit?: number } = {},
): MessagePageParams {
  const max = options.maxLimit ?? MAX_PAGE_SIZE
  return {
    limit: parsePositiveInt(searchParams.get('limit'), options.defaultLimit ?? DEFAULT_PAGE_SIZE, max),
    before: parseIsoCursor(searchParams.get('before')),
  }
}
