import jwt from 'jsonwebtoken'
import { createClient } from '@supabase/supabase-js'
import type { IncomingMessage } from 'node:http'
import type { AppConfig } from '../config.ts'

export interface AuthUser {
  id: string
  email?: string
}

export function getBearerToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim() || null
  }
  return null
}

let verifier: ReturnType<typeof createClient> | null = null
let verifierKey = ''

function getVerifier(config: AppConfig): ReturnType<typeof createClient> | null {
  if (!config.supabaseUrl) return null
  const key = config.supabaseAnonKey ?? config.supabaseServiceRoleKey
  if (!key) return null
  if (verifier && verifierKey === `${config.supabaseUrl}:${key}`) return verifier
  verifier = createClient(config.supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  verifierKey = `${config.supabaseUrl}:${key}`
  return verifier
}

/**
 * Verifies a Supabase access token. Primary path asks Supabase Auth to validate
 * the token (works with legacy and asymmetric signing keys). A local JWT check
 * is used as a fallback when the Auth service cannot be reached.
 */
export async function getAuthUser(
  req: IncomingMessage,
  config: AppConfig,
): Promise<AuthUser | null> {
  const token = getBearerToken(req)
  if (!token) return null

  const client = getVerifier(config)
  if (client) {
    try {
      const { data, error } = await client.auth.getUser(token)
      if (!error && data.user) {
        return { id: data.user.id, email: data.user.email ?? undefined }
      }
    } catch {
      // Network failure: fall through to local verification below.
    }
  }

  if (!config.supabaseJwtSecret) return null
  try {
    const payload = jwt.verify(token, config.supabaseJwtSecret) as Record<string, unknown>
    if (payload.role !== 'authenticated') return null
    if (payload.aud !== 'authenticated') return null
    const sub = payload.sub
    if (typeof sub !== 'string' || sub.length === 0) return null
    const email = typeof payload.email === 'string' ? payload.email : undefined
    return { id: sub, email }
  } catch {
    return null
  }
}
