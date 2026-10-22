import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AppConfig } from '../config.ts'
import { getAuthUser } from '../middleware/auth.ts'
import { getServiceSupabase } from '../lib/supabase/service.ts'
import { HttpError, sendError, sendJson, readJsonBody } from '../lib/http.ts'
import { MAX_BODY_BYTES } from '../constants.ts'

function getUserId(req: IncomingMessage, config: AppConfig): string | null {
  const user = getAuthUser(req, config)
  return user?.id ?? null
}

export async function handleConversations(
  req: IncomingMessage,
  res: ServerResponse,
  config: AppConfig,
  path: string,
): Promise<void> {
  const userId = getUserId(req, config)
  if (!userId) {
    sendError(res, new HttpError(401, 'unauthorized', 'Sign in required.'))
    return
  }
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    sendError(res, new HttpError(503, 'not_configured', 'Supabase not configured.'))
    return
  }

  const supabase = getServiceSupabase(config)

  // GET /api/conversations
  if (req.method === 'GET' && path === '/api/conversations') {
    const { data, error } = await supabase
      .from('conversations')
      .select('id,title,created_at,updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
    if (error) {
      sendError(res, new HttpError(500, 'db_error', 'Failed to load conversations.'))
      return
    }
    sendJson(res, 200, { conversations: data ?? [] })
    return
  }

  // POST /api/conversations
  if (req.method === 'POST' && path === '/api/conversations') {
    const body = await readJsonBody(req, MAX_BODY_BYTES)
    if (!body.ok) {
      sendError(res, body.error ?? new HttpError(400, 'invalid_body', 'Invalid request body.'))
      return
    }
    const title = typeof (body.value as any)?.title === 'string' ? (body.value as any).title.trim() : 'New chat'
    const safeTitle = title.length === 0 ? 'New chat' : title.slice(0, 200)
    const { data, error } = await supabase
      .from('conversations')
      .insert({ user_id: userId, title: safeTitle })
      .select('id,title,created_at,updated_at')
      .single()
    if (error || !data) {
      sendError(res, new HttpError(500, 'db_error', 'Failed to create conversation.'))
      return
    }
    sendJson(res, 201, { conversation: data })
    return
  }

  // /api/conversations/:id
  const match = path.match(/^\/api\/conversations\/([^/]+)$/)
  if (match) {
    const id = match[1]
    // PATCH rename
    if (req.method === 'PATCH') {
      const body = await readJsonBody(req, MAX_BODY_BYTES)
      if (!body.ok) {
        sendError(res, body.error ?? new HttpError(400, 'invalid_body', 'Invalid request body.'))
        return
      }
      const title = typeof (body.value as any)?.title === 'string' ? (body.value as any).title.trim() : ''
      if (title.length === 0) {
        sendError(res, new HttpError(400, 'invalid_request', 'Title is required.'))
        return
      }
      const safeTitle = title.slice(0, 200)
      const { data, error } = await supabase
        .from('conversations')
        .update({ title: safeTitle })
        .eq('id', id)
        .eq('user_id', userId)
        .select('id,title,created_at,updated_at')
        .maybeSingle()
      if (error) {
        sendError(res, new HttpError(500, 'db_error', 'Failed to rename conversation.'))
        return
      }
      if (!data) {
        sendError(res, new HttpError(404, 'not_found', 'Conversation not found.'))
        return
      }
      sendJson(res, 200, { conversation: data })
      return
    }
    // DELETE
    if (req.method === 'DELETE') {
      const { error } = await supabase.from('conversations').delete().eq('id', id).eq('user_id', userId)
      if (error) {
        sendError(res, new HttpError(500, 'db_error', 'Failed to delete conversation.'))
        return
      }
      sendJson(res, 200, { ok: true })
      return
    }
    // GET messages
    if (req.method === 'GET') {
      // verify ownership first
      const { data: conv } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle()
      if (!conv) {
        sendError(res, new HttpError(404, 'not_found', 'Conversation not found.'))
        return
      }
      const { data, error } = await supabase
        .from('messages')
        .select('id,role,content,model,created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true })
      if (error) {
        sendError(res, new HttpError(500, 'db_error', 'Failed to load messages.'))
        return
      }
      sendJson(res, 200, { messages: data ?? [] })
      return
    }
  }

  sendError(res, new HttpError(404, 'not_found', 'Unknown route.'))
}
