import type { AppConfig } from '../../config.ts'
import { HttpError } from '../errors.ts'
import { getUserSupabase } from '../supabase/user.ts'

export interface ConversationDocument {
  id: string
  filename: string
}

/**
 * Resolves the completed documents that belong to a conversation. The client
 * never supplies document ids for chat: ownership is verified through RLS and
 * the attachment table.
 */
export async function loadConversationDocuments(
  config: AppConfig,
  accessToken: string,
  userId: string,
  conversationId: string,
): Promise<ConversationDocument[]> {
  const supabase = getUserSupabase(config, accessToken)

  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .maybeSingle()
  if (conversationError) throw conversationError
  if (!conversation) {
    throw new HttpError(404, 'not_found', 'Conversation not found.')
  }

  const [attachments, legacy] = await Promise.all([
    supabase
      .from('document_attachments')
      .select('document_id')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId),
    supabase
      .from('documents')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId),
  ])

  if (attachments.error && attachments.error.code !== '42P01') {
    throw attachments.error
  }

  const ids = new Set<string>()
  for (const row of (attachments.data ?? []) as Array<{ document_id: string }>) {
    ids.add(row.document_id)
  }
  for (const row of (legacy.data ?? []) as Array<{ id: string }>) {
    ids.add(row.id)
  }
  if (ids.size === 0) return []

  const { data, error } = await supabase
    .from('documents')
    .select('id,filename')
    .in('id', [...ids])
    .eq('user_id', userId)
    .eq('status', 'completed')
    .limit(200)
  if (error) throw error

  return ((data ?? []) as Array<{ id: string; filename: string }>).map((document) => ({
    id: document.id,
    filename: document.filename,
  }))
}
