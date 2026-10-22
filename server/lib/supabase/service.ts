import { createClient } from '@supabase/supabase-js'
import type { AppConfig } from '../../config.ts'

let serviceClient: ReturnType<typeof createClient> | null = null

export function getServiceSupabase(config: AppConfig) {
  if (serviceClient) return serviceClient
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('Supabase service role not configured')
  }
  serviceClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return serviceClient
}
