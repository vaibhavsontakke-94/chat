import jwt from 'jsonwebtoken'
import type { IncomingMessage } from 'node:http'
import type { AppConfig } from '../config.ts'

export interface AuthUser {
  id: string
  email?: string
}

function getToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim() || null
  }
  // Also allow cookie-based if present later; header is primary
  return null
}

export function getAuthUser(req: IncomingMessage, config: AppConfig): AuthUser | null {
  const token = getToken(req)
  if (!token) return null
  if (!config.supabaseJwtSecret) return null
  try {
    const payload = jwt.verify(token, config.supabaseJwtSecret) as Record<string, unknown>
    const sub = payload.sub
    if (typeof sub !== 'string' || sub.length === 0) return null
    const email = typeof payload.email === 'string' ? payload.email : undefined
    return { id: sub, email }
  } catch {
    return null
  }
}
