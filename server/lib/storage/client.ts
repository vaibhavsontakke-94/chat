import { createClient } from '@supabase/supabase-js'
import type { AppConfig } from '../config.ts'

let storageClient: ReturnType<typeof createClient> | null = null

export function getStorageClient(config: AppConfig) {
  if (storageClient) return storageClient
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('Supabase not configured for storage')
  }
  storageClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return storageClient
}

export const DOCUMENTS_BUCKET = 'documents'
