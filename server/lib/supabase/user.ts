import { createClient } from '@supabase/supabase-js'
import type { AppConfig } from '../../config.ts'

/**
 * A per-request Supabase client that acts as the authenticated user.
 * All queries/storage calls are therefore constrained by RLS as well as the
 * explicit ownership checks in the route handlers.
 */
export function getUserSupabase(config: AppConfig, accessToken: string) {
  if (!config.supabaseUrl) throw new Error('Supabase URL is not configured')
  const key = config.supabaseAnonKey ?? config.supabaseServiceRoleKey
  if (!key) throw new Error('Supabase public key is not configured')

  return createClient(config.supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}
