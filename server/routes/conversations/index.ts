import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AppConfig } from '../../config.ts'
import { getAuthUser, getBearerToken } from '../../middleware/auth.ts'
import { getUserSupabase } from '../../lib/supabase/user.ts'
import { HttpError } from '../../lib/errors.ts'
import { sendError, sendJson, readJsonBody } from '../../lib/http.ts'
import { MAX_BODY_BYTES } from '../../constants.ts'
import { parseListParams, parseMessagePageParams } from '../../lib/pagination.ts'

const MAX_TITLE_LENGTH = 200
const MAX_CLIENT_ID_LENGTH = 200
const MAX_CITATIONS = 20

interface StoredCitation {
  filename: string
  page_number: number | null
  chunk_id: string
  similarity: number
}

interface MessageRow {
  id: string
  role: string
  content: string
  model: string | null
  created_at: string
  metadata?: Record<string, unknown> | null
}

async function getUserId(req: IncomingMessage, config: AppConfig): Promise<string | null> {
  const user = await getAuthUser(req, config)
  return user?.id ?? null
}

function readClientId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, MAX_CLIENT_ID_LENGTH)
}

function readTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : ''
  return title.length === 0 ? 'New chat' : title.slice(0, MAX_TITLE_LENGTH)
}

function parseCitations(value: unknown): StoredCitation[] {
  if (!Array.isArray(value)) return []
  const citations: StoredCitation[] = []

  for (const entry of value.slice(0, MAX_CITATIONS)) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (typeof record.filename !== 'string' || typeof record.chunk_id !== 'string') continue
    citations.push({
      filename: record.filename.slice(0, 300),
      page_number:
        typeof record.page_number === 'number' && Number.isFinite(record.page_number)
          ? Math.trunc(record.page_number)
          : null,
      chunk_id: record.chunk_id.slice(0, 100),
      similarity:
        typeof record.similarity === 'number' && Number.isFinite(record.similarity)
          ? record.similarity
          : 0,
    })
  }

  return citations
}

function messageMetadata(citations: StoredCitation[]): Record<string, unknown> {
  return citations.length > 0 ? { citations } : {}
}

export async function handleConversations(
  req: IncomingMessage,
  res: ServerResponse,
  config: AppConfig,
  path: string,
  searchParams: URLSearchParams = new URLSearchParams(),
): Promise<void> {
  const userId = await getUserId(req, config)
  const accessToken = getBearerToken(req)
  if (!userId || !accessToken) {
    sendError(res, new HttpError(401, 'unauthorized', 'Sign in required.'))
    return
  }
  if (!config.supabaseUrl || (!config.supabaseAnonKey && !config.supabaseServiceRoleKey)) {
    sendError(res, new HttpError(503, 'not_configured', 'Supabase not configured.'))
    return
  }

  const supabase = getUserSupabase(config, accessToken)

  // GET /api/conversations?limit=&offset=
  if (req.method === 'GET' && path === '/api/conversations') {
    const { limit, offset } = parseListParams(searchParams)
    const { data, error } = await supabase
      .from('conversations')
      .select('id,title,created_at,updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit)
    if (error) {
      sendError(res, new HttpError(500, 'db_error', 'Failed to load conversations.'))
      return
    }

    const rows = data ?? []
    const hasMore = rows.length > limit
    const conversations = hasMore ? rows.slice(0, limit) : rows
    sendJson(res, 200, {
      conversations,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    })
    return
  }

  // POST /api/conversations
  if (req.method === 'POST' && path === '/api/conversations') {
    const body = await readJsonBody(req, MAX_BODY_BYTES)
    if (!body.ok) {
      sendError(res, body.error ?? new HttpError(400, 'invalid_body', 'Invalid request body.'))
      return
    }
    const payload = (body.value ?? {}) as Record<string, unknown>
    const title = readTitle(payload.title)
    const clientId = readClientId(payload.clientId ?? payload.client_conversation_id)

    if (clientId) {
      const { data: existing, error: existingErr } = await supabase
        .from('conversations')
        .select('id,title,created_at,updated_at')
        .eq('user_id', userId)
        .eq('client_conversation_id', clientId)
        .maybeSingle()
      if (!existingErr && existing) {
        sendJson(res, 200, { conversation: existing, duplicate: true })
        return
      }
    }

    const insert = {
      user_id: userId,
      title,
      ...(clientId ? { client_conversation_id: clientId } : {}),
    }
    const { data, error } = await supabase
      .from('conversations')
      .insert(insert as never)
      .select('id,title,created_at,updated_at')
      .single()

    if (error || !data) {
      // A concurrent retry may have inserted the same client id first.
      if (clientId && error?.code === '23505') {
        const { data: existing } = await supabase
          .from('conversations')
          .select('id,title,created_at,updated_at')
          .eq('user_id', userId)
          .eq('client_conversation_id', clientId)
          .maybeSingle()
        if (existing) {
          sendJson(res, 200, { conversation: existing, duplicate: true })
          return
        }
      }
      sendError(res, new HttpError(500, 'db_error', 'Failed to create conversation.'))
      return
    }
    sendJson(res, 201, { conversation: data })
    return
  }

  // POST /api/conversations/:id/messages
  const messageMatch = path.match(/^\/api\/conversations\/([^/]+)\/messages$/)
  if (messageMatch && req.method === 'POST') {
    const conversationId = messageMatch[1]!
    const body = await readJsonBody(req, MAX_BODY_BYTES)
    if (!body.ok) {
      sendError(res, body.error ?? new HttpError(400, 'invalid_body', 'Invalid request body.'))
      return
    }

    const payload = (body.value ?? {}) as Record<string, unknown>
    const role = payload.role
    const content = typeof payload.content === 'string' ? payload.content.trim() : ''
    const model = typeof payload.model === 'string' ? payload.model.slice(0, 200) : null
    const clientMessageId = readClientId(
      payload.clientMessageId ?? payload.client_message_id,
    )
    const citations = parseCitations(payload.citations)

    if (role !== 'user' && role !== 'assistant') {
      sendError(res, new HttpError(400, 'invalid_request', 'Role must be user or assistant.'))
      return
    }
    if (content.length === 0 || content.length > 100_000) {
      sendError(res, new HttpError(400, 'invalid_request', 'Message content is invalid.'))
      return
    }

    const { data: conversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .maybeSingle()
    if (!conversation) {
      sendError(res, new HttpError(404, 'not_found', 'Conversation not found.'))
      return
    }

    // Idempotency: a retried request returns the row that was already stored.
    if (clientMessageId) {
      const { data: existing } = await supabase
        .from('messages')
        .select('id,role,content,model,created_at,metadata')
        .eq('conversation_id', conversationId)
        .eq('client_message_id', clientMessageId)
        .maybeSingle()
      if (existing) {
        sendJson(res, 200, { message: existing, duplicate: true })
        return
      }
    }

    const insert = {
      conversation_id: conversationId,
      user_id: userId,
      role,
      content,
      model,
      client_message_id: clientMessageId,
      metadata: messageMetadata(citations),
    }
    const { data, error } = await supabase
      .from('messages')
      .insert(insert as never)
      .select('id,role,content,model,created_at,metadata')
      .single()

    if (error || !data) {
      if (clientMessageId && error?.code === '23505') {
        const { data: existing } = await supabase
          .from('messages')
          .select('id,role,content,model,created_at,metadata')
          .eq('conversation_id', conversationId)
          .eq('client_message_id', clientMessageId)
          .maybeSingle()
        if (existing) {
          sendJson(res, 200, { message: existing, duplicate: true })
          return
        }
      }
      sendError(res, new HttpError(500, 'db_error', 'Failed to save message.'))
      return
    }

    await (supabase.from('conversations') as any)
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('user_id', userId)

    sendJson(res, 201, { message: data })
    return
  }

  // /api/conversations/:id
  const match = path.match(/^\/api\/conversations\/([^/]+)$/)
  if (match) {
    const id = match[1]!
    // PATCH rename
    if (req.method === 'PATCH') {
      const body = await readJsonBody(req, MAX_BODY_BYTES)
      if (!body.ok) {
        sendError(res, body.error ?? new HttpError(400, 'invalid_body', 'Invalid request body.'))
        return
      }
      const rawTitle =
        typeof (body.value as Record<string, unknown> | null)?.title === 'string'
          ? ((body.value as Record<string, unknown>).title as string).trim()
          : ''
      if (rawTitle.length === 0) {
        sendError(res, new HttpError(400, 'invalid_request', 'Title is required.'))
        return
      }
      const title = rawTitle.slice(0, MAX_TITLE_LENGTH)
      const { data, error } = await (supabase.from('conversations') as any)
        .update({ title })
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
    // GET messages (newest page first, returned oldest-first)
    if (req.method === 'GET') {
      const { limit, before } = parseMessagePageParams(searchParams)

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

      let query = supabase
        .from('messages')
        .select('id,role,content,model,created_at,metadata')
        .eq('conversation_id', id)
        .order('created_at', { ascending: false })
        .limit(limit + 1)

      if (before) query = query.lt('created_at', before)

      const { data, error } = await query
      if (error) {
        sendError(res, new HttpError(500, 'db_error', 'Failed to load messages.'))
        return
      }

      const rows = (data ?? []) as MessageRow[]
      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      const ordered = [...page].reverse()
      sendJson(res, 200, {
        messages: ordered,
        hasMore,
        nextCursor: hasMore ? (ordered[0]?.created_at ?? null) : null,
      })
      return
    }
  }

  sendError(res, new HttpError(404, 'not_found', 'Unknown route.'))
}
