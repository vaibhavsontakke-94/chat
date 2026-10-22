import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from '../constants.ts'

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

/** Fixed-window limiter, keyed by client IP. */
export function consumeRateLimit(key: string): RateLimitResult {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
      retryAfterSeconds: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
    }
  }

  bucket.count += 1
  const allowed = bucket.count <= RATE_LIMIT_MAX_REQUESTS
  return {
    allowed,
    remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  }
}

/** Prevents the limiter map from growing without bound. */
export function pruneRateLimits(): void {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}
