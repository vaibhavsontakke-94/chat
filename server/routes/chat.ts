import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AppConfig } from '../config.ts'
import { MAX_BODY_BYTES } from '../constants.ts'
import { HttpError, ProviderError } from '../lib/errors.ts'
import { streamChatCompletion } from '../lib/groq.ts'
import { clientIp, isOriginAllowed, openSse, readJsonBody, sendError } from '../lib/http.ts'
import { consumeRateLimit } from '../lib/rateLimit.ts'
import { isUuid, validateChatRequest, type ChatRequest } from '../lib/validate.ts'
import { getAuthUser, getBearerToken } from '../middleware/auth.ts'
import { retrieveRelevantChunks, type RetrievedChunk } from '../lib/rag/retrieve.ts'
import { buildRagPrompt, type RagCitation } from '../lib/rag/prompt.ts'
import {
  classifyQuestion,
  expandVagueDocumentQuestion,
  fallbackMode,
  looksDocumentSpecific,
  type ChatMode,
} from '../lib/rag/router.ts'
import { loadConversationDocuments } from '../lib/rag/conversationDocuments.ts'
import { ragDebug, ragDebugError, shortId } from '../lib/rag/debug.ts'

async function streamResponse(
  res: ServerResponse,
  config: AppConfig,
  request: ChatRequest,
  citations?: { items: RagCitation[]; mode: ChatMode },
): Promise<void> {
  const sse = openSse(res)
  const controller = new AbortController()
  const abort = () => controller.abort()
  res.on('close', abort)

  try {
    if (citations) {
      sse.event('citations', {
        citations: citations.items,
        found: citations.items.length > 0,
        mode: citations.mode,
      })
    }
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
      sse.event('error', {
        code: 'unexpected_error',
        message: 'Something went wrong while generating the response.',
      })
    }
  } finally {
    res.off('close', abort)
    sse.close()
  }
}

/**
 * POST /api/chat - streams a completion from the configured provider as SSE.
 * Document context is resolved server-side from the conversation's persisted
 * attachments; client-supplied document ids are not trusted.
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

  const raw = body.value as Record<string, unknown>
  const ragRequested = raw?.rag === true
  const conversationId = isUuid(raw?.conversationId) ? raw.conversationId : null

  const validation = validateChatRequest(body.value, { fallbackModel: config.groqChatModel })
  if (!validation.ok) {
    sendError(res, new HttpError(400, 'invalid_request', validation.error.message))
    return
  }
  let request = validation.value

  const lastUserIndex = request.messages.findLastIndex((message) => message.role === 'user')
  const lastUser = lastUserIndex >= 0 ? request.messages[lastUserIndex] : null
  if (!lastUser) {
    sendError(res, new HttpError(400, 'invalid_request', 'No user message found.'))
    return
  }

  if (ragRequested && !conversationId) {
    sendError(
      res,
      new HttpError(400, 'invalid_request', 'conversationId is required for document chat.'),
    )
    return
  }

  if (!conversationId) {
    await streamResponse(res, config, request)
    return
  }

  const user = await getAuthUser(req, config)
  const accessToken = getBearerToken(req)
  if (!user || !accessToken) {
    sendError(res, new HttpError(401, 'unauthorized', 'Authentication required for this chat.'))
    return
  }

  let conversationDocuments
  try {
    conversationDocuments = await loadConversationDocuments(
      config,
      accessToken,
      user.id,
      conversationId,
    )
  } catch (error) {
    if (error instanceof HttpError) {
      sendError(res, error)
      return
    }
    sendError(res, new HttpError(500, 'db_error', 'Failed to load conversation documents.'))
    return
  }

  if (conversationDocuments.length === 0) {
    await streamResponse(res, config, request)
    return
  }

  const documentIds = conversationDocuments.map((document) => document.id)
  const effectiveQuestion = expandVagueDocumentQuestion(lastUser.content)
  ragDebug('chat.documents', {
    conversation: shortId(conversationId),
    documents: documentIds.length,
    question_length: lastUser.content.length,
    expanded_question: effectiveQuestion !== lastUser.content,
  })

  let candidates: RetrievedChunk[]
  try {
    candidates = await retrieveRelevantChunks(
      effectiveQuestion,
      user.id,
      config,
      {
        topK: Math.max(config.ragMaxContextChunks, 8),
        threshold: 0,
        documentIds,
        conversationId,
      },
      accessToken,
    )
  } catch (error) {
    ragDebugError('chat.retrieval_failed', error)
    sendError(
      res,
      new HttpError(
        502,
        'retrieval_failed',
        'Document retrieval failed. Check the embeddings configuration and try again.',
      ),
    )
    return
  }

  const relevant = candidates
    .filter((chunk) => chunk.similarity >= config.ragSimilarityThreshold)
    .slice(0, config.ragMaxContextChunks)
  ragDebug('chat.retrieval', {
    conversation: shortId(conversationId),
    candidates: candidates.length,
    relevant: relevant.length,
    threshold: config.ragSimilarityThreshold,
    document_count: documentIds.length,
  })

  let mode: ChatMode
  try {
    mode = await classifyQuestion({
      config,
      question: effectiveQuestion,
      documentNames: conversationDocuments.map((document) => document.filename),
      chunks: candidates.slice(0, 5),
      signal: AbortSignal.timeout(8_000),
    })
  } catch (error) {
    ragDebugError('chat.classifier_failed', error)
    mode = fallbackMode(effectiveQuestion, conversationDocuments.length, relevant.length)
  }

  if (mode === 'general' && relevant.length > 0 && looksDocumentSpecific(effectiveQuestion)) {
    mode = 'document'
  } else if (mode === 'general' && relevant.length > 0 && effectiveQuestion !== lastUser.content) {
    mode = 'document'
  }

  ragDebug('chat.mode', { mode, relevant: relevant.length })

  if (mode === 'general') {
    await streamResponse(res, config, request)
    return
  }

  const promptChunks = mode === 'document' && relevant.length === 0 ? [] : relevant
  const { prompt, citations } = buildRagPrompt(effectiveQuestion, promptChunks, mode)
  ragDebug('chat.prompt', {
    mode,
    chunks: promptChunks.length,
    prompt_chars: prompt.length,
    has_context: promptChunks.length > 0,
  })
  request = {
    ...request,
    temperature: 0.2,
    messages: request.messages.map((message, index) =>
      index === lastUserIndex ? { role: 'user', content: prompt } : message,
    ),
  }

  await streamResponse(res, config, request, { items: citations, mode })
}
