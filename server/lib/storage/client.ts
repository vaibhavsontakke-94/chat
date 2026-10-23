import { createClient } from '@supabase/supabase-js'
import type { AppConfig } from '../../config.ts'

let storageClient: ReturnType<typeof createClient> | null = null
let bucketReady = false

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

export async function getStorageClientWithBucket(config: AppConfig) {
  const client = getStorageClient(config)
  if (bucketReady) return client

  const { data, error } = await client.storage.getBucket(DOCUMENTS_BUCKET)
  if (data) {
    bucketReady = true
    return client
  }
  if (error && !/not found|does not exist/i.test(error.message)) {
    throw new Error(`Could not read the "${DOCUMENTS_BUCKET}" storage bucket: ${error.message}`)
  }

  const { error: createError } = await client.storage.createBucket(DOCUMENTS_BUCKET, {
    public: false,
  })
  if (createError && !/already exists|duplicate/i.test(createError.message)) {
    throw new Error(
      `Could not create the "${DOCUMENTS_BUCKET}" storage bucket: ${createError.message}`,
    )
  }

  bucketReady = true
  return client
}

export const DOCUMENTS_BUCKET = 'documents'
