import type { AppConfig } from '../../config.ts'
import type { getUserSupabase } from '../supabase/user.ts'
import { DOCUMENTS_BUCKET, getStorageClientWithBucket } from './client.ts'

type UserClient = ReturnType<typeof getUserSupabase>

export function safeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'document'
  const cleaned = base.replace(/[^\w.\- ]+/g, '_').trim()
  return cleaned.length > 0 ? cleaned.slice(0, 180) : 'document'
}

export function documentObjectPath(userId: string, documentId: string, filename: string): string {
  return `${userId}/${documentId}/${safeFilename(filename)}`
}

export async function uploadDocumentObject(
  config: AppConfig,
  userClient: UserClient,
  objectPath: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const errors: string[] = []

  if (config.supabaseServiceRoleKey) {
    try {
      const admin = await getStorageClientWithBucket(config)
      const { error } = await admin.storage
        .from(DOCUMENTS_BUCKET)
        .upload(objectPath, buffer, { contentType, upsert: false })
      if (!error) return
      errors.push(error.message)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Storage setup failed.')
    }
  }

  try {
    const { error } = await userClient.storage
      .from(DOCUMENTS_BUCKET)
      .upload(objectPath, buffer, { contentType, upsert: false })
    if (!error) return
    errors.push(error.message)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Storage upload failed.')
  }

  throw new Error(errors.filter(Boolean).join(' | ') || 'Storage upload failed.')
}

export async function removeDocumentObject(
  config: AppConfig,
  userClient: UserClient,
  objectPath: string,
): Promise<void> {
  if (config.supabaseServiceRoleKey) {
    try {
      const admin = await getStorageClientWithBucket(config)
      const { error } = await admin.storage.from(DOCUMENTS_BUCKET).remove([objectPath])
      if (!error) return
    } catch {
      // Fall through to the user-scoped client.
    }
  }
  try {
    await userClient.storage.from(DOCUMENTS_BUCKET).remove([objectPath])
  } catch {
    // Deletion is best effort; the database row is the source of truth.
  }
}

export async function downloadDocumentObject(
  config: AppConfig,
  userClient: UserClient,
  objectPath: string,
): Promise<Buffer> {
  const errors: string[] = []

  if (config.supabaseServiceRoleKey) {
    try {
      const admin = await getStorageClientWithBucket(config)
      const { data, error } = await admin.storage.from(DOCUMENTS_BUCKET).download(objectPath)
      if (!error && data) return Buffer.from(await data.arrayBuffer())
      if (error) errors.push(error.message)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Storage setup failed.')
    }
  }

  try {
    const { data, error } = await userClient.storage.from(DOCUMENTS_BUCKET).download(objectPath)
    if (!error && data) return Buffer.from(await data.arrayBuffer())
    errors.push(error?.message ?? 'The stored file could not be found.')
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Storage download failed.')
  }

  throw new Error(errors.filter(Boolean).join(' | ') || 'Storage download failed.')
}

export async function createSignedDocumentUrl(
  config: AppConfig,
  userClient: UserClient,
  objectPath: string,
  expiresInSeconds = 120,
): Promise<string> {
  const errors: string[] = []

  if (config.supabaseServiceRoleKey) {
    try {
      const admin = await getStorageClientWithBucket(config)
      const { data, error } = await admin.storage
        .from(DOCUMENTS_BUCKET)
        .createSignedUrl(objectPath, expiresInSeconds)
      if (!error && data?.signedUrl) return data.signedUrl
      if (error) errors.push(error.message)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Storage setup failed.')
    }
  }

  const { data, error } = await userClient.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(objectPath, expiresInSeconds)
  if (!error && data?.signedUrl) return data.signedUrl
  errors.push(error?.message ?? 'Could not create a signed link.')

  throw new Error(errors.filter(Boolean).join(' | ') || 'Could not create a signed link.')
}
