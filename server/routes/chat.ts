import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AppConfig } from '../config.ts'
import { MAX_BODY_BYTES } from '../constants.ts'
import { HttpError, ProviderError } from '../lib/errors.ts'
import { streamChatCompletion } from '../lib/groq.ts'
import { clientIp, isOriginAllowed, openSse, readJsonBody, sendError } from '../lib/http.ts'
import { consumeRateLimit } from '../lib/rateLimit.ts'
import { isUuid, validateChatRequest } from '../lib/validate.ts'
import { getAuthUser, getBearerToken } from '../middleware/auth.ts'
import { retrieveRelevantChunks } from '../lib/rag/retrieve.ts'
import { buildRagPrompt } from '../lib/rag/prompt.ts'

/**
 * POST /api/chat - streams a completion from the configured provider as SSE.
 * The provider key never leaves the server; the browser only sees text deltas.
 */
export async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  config: AppConfig,
): Promise<void> {
  if (!isOriginAllowed(req, config.allowedOrigins)) {
    sendError(res, new HttpError(403, 'origin_not_allowed', 'Request origin is not allowed.'))
    return
  }

  const limit = consumeRateLimit(clientIp(req))
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds))
    sendError(res, new HttpError(429, 'rate_limited', 'Too many requests. Please wait a moment.'))
    return
  }

  const body = await readJsonBody(req, MAX_BODY_BYTES)
  if (!body.ok) {
    sendError(res, body.error ?? new HttpError(400, 'invalid_body', 'Invalid request body.'))
    return
  }

  const raw = body.value as any
  const ragEnabled = raw?.rag === true
  const documentId = isUuid(raw?.documentId) ? raw.documentId : null
  const documentIds = Array.isArray(raw?.documentIds)
    ? raw.documentIds
        .filter((id: unknown): id is string => isUuid(id))
        .slice(0, 20)
    : []
  const conversationId = isUuid(raw?.conversationId) ? raw.conversationId : null

  let request = (await (async () => {
    const validation = validateChatRequest(body.value, { fallbackModel: config.groqChatModel })
    if (!validation.ok) {
      sendError(res, new HttpError(400, 'invalid_request', validation.error.message))
      return null
    }
    return validation.value
  })())
  if (!request) return

  // RAG path
  if (ragEnabled) {
    const user = await getAuthUser(req, config)
    const accessToken = getBearerToken(req)
    if (!user || !accessToken) {
      sendError(res, new HttpError(401, 'unauthorized', 'Authentication required for document chat.'))
      return
    }
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) {
      sendError(res, new HttpError(400, 'invalid_request', 'No user message found.'))
      return
    }
    try {
      const chunks = await retrieveRelevantChunks(
        lastUser.content,
        user.id,
        config,
        {
          topK: 5,
          threshold: 0.2,
          documentId,
          documentIds,
          conversationId,
        },
        accessToken,
      )
      const { prompt, citations } = buildRagPrompt(lastUser.content, chunks)
      // Replace messages with grounded prompt (preserve system if desired minimal)
      request = {
        ...request,
        messages: [
          { role: 'user', content: prompt },
        ],
      }
      // We'll emit citations before streaming starts by attaching to start? Client expects start/delta/done; add a custom event not required, but we can include in start via headers not possible in SSE body - easier to emit a citations event first
      const sse = openSse(res)
      const controller = new AbortController()
      const abort = () => controller.abort()
      res.on('close', abort)
      try {
        sse.event('citations', { citations, found: citations.length > 0 })
        for await (const event of streamChatCompletion(config, request, controller.signal)) {
          if (controller.signal.aborted) break
          sse.event(event.type, event)
        }
      } catch (error) {
        if (controller.signal.aborted) {
          sse.event('cancelled', { ok: true })
        } else if (error instanceof ProviderError) {
          sse.event('error', { code: error.code, message: error.message })
        } else {
          sse.event('error', { code: 'unexpected_error', message: 'Something went wrong while generating the response.' })
        }
      } finally {
        sse.close()
      }
      return
    } catch (e: any) {
      sendError(res, new HttpError(500, 'rag_error', e?.message || 'Retrieval failed.'))
      return
    }
  }

  const sse = openSse(res)
  const controller = new AbortController()

  const abort = () => controller.abort()
  res.on('close', abort)

  try {
    for await (const event of streamChatCompletion(config, request, controller.signal)) {
      if (controller.signal.aborted) break
      sse.event(event.type, event)
    }
  } catch (error) {
    if (controller.signal.aborted) {
      // The client cancelled the request; nothing to report.
      sse.event('cancelled', { ok: true })
    } else if (error instanceof ProviderError) {
      sse.event('error', { code: error.code, message: error.message })
    } else {
      sse.event('error', {
        code: 'unexpected_error',
        message: 'Something went wrong while generating the response.',
      })
    }
  } finally {
    sse.close()
  }
}
