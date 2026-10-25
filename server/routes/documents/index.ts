import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AppConfig } from '../../config.ts'
import { getAuthUser, getBearerToken } from '../../middleware/auth.ts'
import { getUserSupabase } from '../../lib/supabase/user.ts'
import { getServiceSupabase } from '../../lib/supabase/service.ts'
import { HttpError } from '../../lib/errors.ts'
import { readJsonBody, sendError, sendJson } from '../../lib/http.ts'
import {
  DocumentExtractionError,
  extractDocument,
  resolveDocumentType,
} from '../../lib/ingest/extract.ts'
import { chunkPages } from '../../lib/ingest/chunker.ts'
import { embedText } from '../../lib/ingest/embeddings.ts'
import { isUuid } from '../../lib/validate.ts'
import { ragDebug, ragDebugError, shortId } from '../../lib/rag/debug.ts'
import { retrieveRelevantChunks } from '../../lib/rag/retrieve.ts'
import { buildRagPrompt } from '../../lib/rag/prompt.ts'
import { expandVagueDocumentQuestion } from '../../lib/rag/router.ts'
import {
  createSignedDocumentUrl,
  documentObjectPath,
  downloadDocumentObject,
  removeDocumentObject,
  uploadDocumentObject,
} from '../../lib/storage/documents.ts'

const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 64 * 1024
const MAX_PAGES = 50
const STALE_PROCESSING_MS = 15 * 60_000
const STALE_UPLOADING_MS = 2 * 60_000
const CRON_BATCH_SIZE = 3

type DbClient = ReturnType<typeof getUserSupabase>

function embeddingDimensions(value: unknown): number | null {
  if (Array.isArray(value)) return value.length
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.length : null
  } catch {
    return null
  }
}

interface DocumentRow {
  id: string
  user_id: string
  filename: string
  mime_type: string | null
  status: string
  conversation_id: string | null
  updated_at: string | null
}

async function getUserId(req: IncomingMessage, config: AppConfig): Promise<string | null> {
  const user = await getAuthUser(req, config)
  return user?.id ?? null
}

function parseMultipart(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{
  fields: Record<string, string>
  file?: { filename: string; contentType: string; buffer: Buffer }
}> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || ''
    const boundaryMatch = contentType.match(/boundary=(.+)$/)
    if (!boundaryMatch) return reject(new Error('invalid_multipart'))
    let boundary = boundaryMatch[1].trim()
    if (boundary.startsWith('"') && boundary.endsWith('"')) boundary = boundary.slice(1, -1)
    const delimiter = '--' + boundary
    const chunks: Buffer[] = []
    let total = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      if (tooLarge) return
      total += chunk.length
      if (total > maxBytes) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(Buffer.from(chunk))
    })
    req.on('end', () => {
      if (tooLarge) {
        reject(new Error('too_large'))
        return
      }
      try {
        const body = Buffer.concat(chunks)
        const bodyStr = body.toString('latin1')
        const parts = bodyStr.split(delimiter)
        const fields: Record<string, string> = {}
        let file: { filename: string; contentType: string; buffer: Buffer } | undefined
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]
          if (!part || part === '--' || part === '--\r\n') continue
          const headerEnd = part.indexOf('\r\n\r\n')
          if (headerEnd === -1) continue
          const headers = part.slice(0, headerEnd)
          let content = part.slice(headerEnd + 4)
          if (content.endsWith('\r\n')) content = content.slice(0, -2)
          const nameMatch = headers.match(/name="([^"]+)"/)
          const filenameMatch = headers.match(/filename="([^"]+)"/)
          const ctypeMatch = headers.match(/Content-Type:\s*(.+)/i)
          const name = nameMatch?.[1] || ''
          if (filenameMatch && name === 'file') {
            file = {
              filename: filenameMatch[1],
              contentType: ctypeMatch?.[1]?.trim() || 'application/pdf',
              buffer: Buffer.from(content, 'latin1'),
            }
          } else if (name) {
            fields[name] = content
          }
        }
        resolve({ fields, file })
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpError || error instanceof DocumentExtractionError) {
    return error.message
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return 'Document processing failed.'
}

async function markDocumentFailed(
  supabase: DbClient,
  documentId: string,
  userId: string,
  message: string,
): Promise<void> {
  try {
    await (supabase.from('documents') as any)
      .update({ status: 'failed', error_message: message.slice(0, 500) })
      .eq('id', documentId)
      .eq('user_id', userId)
  } catch {
    // The original error is more useful than a failed status update.
  }
}

async function removeDocumentChunks(
  supabase: DbClient,
  documentId: string,
  userId: string,
): Promise<void> {
  try {
    await supabase.from('document_chunks').delete().eq('document_id', documentId).eq('user_id', userId)
  } catch {
    // Cleanup is best effort; the status update reports the real failure.
  }
}

async function getOwnedConversation(
  supabase: DbClient,
  conversationId: string,
  userId: string,
): Promise<boolean> {
  if (!isUuid(conversationId)) return false
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .maybeSingle()
  return Boolean(data)
}

async function attachDocument(
  supabase: DbClient,
  documentId: string,
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const { error } = await (supabase.from('document_attachments') as any).insert({
    document_id: documentId,
    conversation_id: conversationId,
    user_id: userId,
  })
  if (!error) return true
  if (error.code === '23505') return true
  return false
}

interface IndexDocumentInput {
  config: AppConfig
  supabase: DbClient
  documentId: string
  userId: string
  conversationId: string | null
  filename: string
  contentType: string
  buffer: Buffer
}

async function indexDocument(input: IndexDocumentInput): Promise<{ chunks: number; pages: number }> {
  const { config, supabase, documentId, userId, conversationId, filename, contentType, buffer } =
    input

  let extracted
  try {
    extracted = await extractDocument({ buffer, filename, contentType })
  } catch (error) {
    if (error instanceof DocumentExtractionError) {
      throw new HttpError(422, error.code, error.message)
    }
    throw new HttpError(
      422,
      'extract_failed',
      'Failed to extract text from the document. It may be corrupted, encrypted, or unsupported.',
    )
  }

  if (extracted.kind === 'pdf' && extracted.numpages > MAX_PAGES) {
    throw new HttpError(422, 'too_many_pages', `PDF has too many pages (max ${MAX_PAGES}).`)
  }

  ragDebug('document.extracted', {
    document: shortId(documentId),
    kind: extracted.kind,
    pages: extracted.numpages,
    text_length: extracted.text.length,
  })

  const pages =
    extracted.pages.length > 0 ? extracted.pages : [{ pageNumber: 1, text: extracted.text }]
  const chunks = chunkPages(pages, { chunkSize: 1000, overlap: 200 })
  if (chunks.length === 0 || extracted.text.trim().length === 0) {
    throw new HttpError(
      422,
      'empty_document',
      extracted.kind === 'image'
        ? 'No readable text was found in this image.'
        : 'No extractable text found in this document.',
    )
  }

  ragDebug('document.chunked', {
    document: shortId(documentId),
    chunks: chunks.length,
    first_chunk_length: chunks[0]?.content.length ?? 0,
  })

  const texts = chunks.map((chunk) => chunk.content)
  const embeddings = await embedText(texts, config, { taskType: 'document' })
  if (embeddings.length !== chunks.length) {
    throw new Error('The embedding service returned an unexpected number of vectors.')
  }
  ragDebug('document.embedded', {
    document: shortId(documentId),
    vectors: embeddings.length,
    dimensions: embeddings[0]?.length ?? 0,
  })

  const rows = chunks.map((chunk, index) => ({
    document_id: documentId,
    user_id: userId,
    conversation_id: conversationId,
    chunk_index: chunk.index,
    page_number: chunk.pageNumber,
    content: chunk.content,
    embedding: embeddings[index],
    metadata: {
      filename,
      page_number: chunk.pageNumber,
      chunk_index: chunk.index,
    },
  }))

  // Reindexing replaces the previous vectors for this document.
  const { error: deleteErr } = await supabase
    .from('document_chunks')
    .delete()
    .eq('document_id', documentId)
    .eq('user_id', userId)
  if (deleteErr) throw new Error(deleteErr.message)

  const batchSize = 50
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error: insErr } = await (supabase.from('document_chunks') as any).insert(batch)
    if (insErr) throw new Error(insErr.message)
  }

  const { error: completedErr } = await (supabase.from('documents') as any)
    .update({
      status: 'completed',
      page_count: extracted.numpages,
      error_message: null,
    })
    .eq('id', documentId)
    .eq('user_id', userId)
  if (completedErr) throw new Error(completedErr.message)

  ragDebug('document.completed', {
    document: shortId(documentId),
    conversation: shortId(conversationId),
    chunks: chunks.length,
    pages: extracted.numpages,
  })

  return { chunks: chunks.length, pages: extracted.numpages }
}

interface ProcessJob {
  config: AppConfig
  supabase: DbClient
  documentId: string
  userId: string
  filename: string
  contentType: string
  objectPath: string
  conversationId: string | null
  buffer?: Buffer
  claim: boolean
  expectedStatus?: 'uploading' | 'processing'
}

const activeProcessing = new Set<string>()

async function claimDocument(job: ProcessJob): Promise<boolean> {
  if (!job.claim) return true

  let query = (job.supabase.from('documents') as any)
    .update({ status: 'processing', error_message: null })
    .eq('id', job.documentId)
    .eq('user_id', job.userId)

  if (job.expectedStatus === 'processing') {
    query = query
      .eq('status', 'processing')
      .lt('updated_at', new Date(Date.now() - STALE_PROCESSING_MS).toISOString())
  } else {
    query = query.in('status', ['uploading', 'failed'])
  }

  const { data, error } = await query.select('id')
  if (error) return false
  return Array.isArray(data) && data.length > 0
}

async function processDocument(job: ProcessJob): Promise<{ chunks: number; pages: number } | null> {
  if (activeProcessing.has(job.documentId)) return null
  if (!(await claimDocument(job))) return null

  ragDebug('document.processing', {
    document: shortId(job.documentId),
    conversation: shortId(job.conversationId),
    has_buffer: Boolean(job.buffer),
  })

  activeProcessing.add(job.documentId)
  try {
    const buffer =
      job.buffer ?? (await downloadDocumentObject(job.config, job.supabase, job.objectPath))
    const result = await indexDocument({
      config: job.config,
      supabase: job.supabase,
      documentId: job.documentId,
      userId: job.userId,
      conversationId: job.conversationId,
      filename: job.filename,
      contentType: job.contentType,
      buffer,
    })
    return result
  } catch (error) {
    ragDebugError('document.failed', error)
    await removeDocumentChunks(job.supabase, job.documentId, job.userId)
    await markDocumentFailed(job.supabase, job.documentId, job.userId, errorMessage(error))
    throw error
  } finally {
    activeProcessing.delete(job.documentId)
  }
}

function scheduleProcessing(job: ProcessJob): void {
  const timer = setTimeout(() => {
    void processDocument(job).catch(() => undefined)
  }, 0)
  timer.unref()
}

function secretMatches(value: string | undefined, expected: string): boolean {
  if (!value) return false
  const actual = Buffer.from(value)
  const wanted = Buffer.from(expected)
  if (actual.length !== wanted.length) return false
  return timingSafeEqual(actual, wanted)
}

async function handleProcessingQueue(
  req: IncomingMessage,
  res: ServerResponse,
  config: AppConfig,
): Promise<void> {
  if (!config.cronSecret) {
    sendError(res, new HttpError(503, 'not_configured', 'CRON_SECRET is not configured.'))
    return
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendError(res, new HttpError(405, 'method_not_allowed', 'Method not allowed.'))
    return
  }
  if (!secretMatches(req.headers.authorization, `Bearer ${config.cronSecret}`)) {
    sendError(res, new HttpError(401, 'unauthorized', 'Invalid processing secret.'))
    return
  }
  if (!config.supabaseServiceRoleKey) {
    sendError(
      res,
      new HttpError(503, 'not_configured', 'Supabase service role key is required for background processing.'),
    )
    return
  }

  const service = getServiceSupabase(config) as unknown as DbClient
  const uploadingCutoff = new Date(Date.now() - STALE_UPLOADING_MS).toISOString()
  const processingCutoff = new Date(Date.now() - STALE_PROCESSING_MS).toISOString()

  const [uploading, processing] = await Promise.all([
    service
      .from('documents')
      .select('id,user_id,filename,mime_type,status,conversation_id,updated_at')
      .eq('status', 'uploading')
      .lt('updated_at', uploadingCutoff)
      .limit(CRON_BATCH_SIZE),
    service
      .from('documents')
      .select('id,user_id,filename,mime_type,status,conversation_id,updated_at')
      .eq('status', 'processing')
      .lt('updated_at', processingCutoff)
      .limit(CRON_BATCH_SIZE),
  ])

  if (uploading.error || processing.error) {
    sendError(res, new HttpError(500, 'db_error', 'Failed to load pending documents.'))
    return
  }

  const seen = new Set<string>()
  const jobs = [...(uploading.data ?? []), ...(processing.data ?? [])]
    .filter((row) => {
      const document = row as unknown as DocumentRow
      if (seen.has(document.id)) return false
      seen.add(document.id)
      return true
    })
    .slice(0, CRON_BATCH_SIZE)

  const processed: Array<{ id: string; ok: boolean; chunks?: number; error?: string }> = []
  for (const row of jobs) {
    const document = row as unknown as DocumentRow
    try {
      const result = await processDocument({
        config,
        supabase: service,
        documentId: document.id,
        userId: document.user_id,
        filename: document.filename,
        contentType: document.mime_type ?? '',
        objectPath: documentObjectPath(document.user_id, document.id, document.filename),
        conversationId: document.conversation_id,
        claim: true,
        expectedStatus: document.status === 'processing' ? 'processing' : 'uploading',
      })
      processed.push({
        id: document.id,
        ok: Boolean(result),
        chunks: result?.chunks,
      })
    } catch (error) {
      processed.push({ id: document.id, ok: false, error: errorMessage(error) })
    }
  }

  sendJson(res, 200, { ok: true, processed })
}

export async function handleDocuments(
  req: IncomingMessage,
  res: ServerResponse,
  config: AppConfig,
  path: string,
  searchParams: URLSearchParams = new URLSearchParams(),
): Promise<void> {
  if (path === '/api/documents/process') {
    await handleProcessingQueue(req, res, config)
    return
  }

  const userId = await getUserId(req, config)
  const accessToken = getBearerToken(req)
  if (!userId || !accessToken) {
    sendError(res, new HttpError(401, 'unauthorized', 'Authentication required.'))
    return
  }
  if (!config.supabaseUrl || (!config.supabaseAnonKey && !config.supabaseServiceRoleKey)) {
    sendError(res, new HttpError(503, 'not_configured', 'Supabase not configured.'))
    return
  }

  const supabase = getUserSupabase(config, accessToken)

  // POST /api/documents/upload
  if (req.method === 'POST' && path === '/api/documents/upload') {
    try {
      const parsed = await parseMultipart(req, MAX_MULTIPART_BYTES)
      const file = parsed.file
      if (!file) {
        sendError(res, new HttpError(400, 'invalid_request', 'No file uploaded.'))
        return
      }
      const fileType = resolveDocumentType(file.filename, file.contentType)
      if (!fileType) {
        sendError(
          res,
          new HttpError(
            415,
            'invalid_type',
            'Unsupported file type. Use PDF, DOCX, TXT, MD, CSV, JSON, HTML, PNG, or JPG.',
          ),
        )
        return
      }
      if (file.buffer.length > MAX_FILE_BYTES) {
        sendError(res, new HttpError(413, 'too_large', 'File exceeds 25MB limit.'))
        return
      }
      if (file.buffer.length === 0) {
        sendError(res, new HttpError(415, 'invalid_type', 'The uploaded file is empty.'))
        return
      }
      if (
        fileType.kind === 'pdf' &&
        !file.buffer.subarray(0, 1024).toString('latin1').includes('%PDF-')
      ) {
        sendError(res, new HttpError(415, 'invalid_type', 'The uploaded file is not a valid PDF.'))
        return
      }

      const contentType = fileType.mimeType
      const rawConversationId = parsed.fields.conversationId ?? parsed.fields.conversation_id
      let conversationId: string | null = null
      if (typeof rawConversationId === 'string' && rawConversationId.trim().length > 0) {
        const candidate = rawConversationId.trim()
        if (!isUuid(candidate)) {
          sendError(res, new HttpError(400, 'invalid_request', 'conversationId must be a UUID.'))
          return
        }
        if (!(await getOwnedConversation(supabase, candidate, userId))) {
          sendError(res, new HttpError(404, 'not_found', 'Conversation not found.'))
          return
        }
        conversationId = candidate
      }

      const replace = parsed.fields.replace === 'true' || parsed.fields.replace === '1'

      const { data: existing, error: existingErr } = await (supabase.from('documents') as any)
        .select('id,status,updated_at,filename')
        .eq('user_id', userId)
        .eq('filename', file.filename)
        .eq('size_bytes', file.buffer.length)
        .in('status', ['uploading', 'processing', 'completed', 'failed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (existingErr) {
        sendError(res, new HttpError(500, 'db_error', 'Failed to check for duplicate documents.'))
        return
      }

      const existingDoc = existing as
        | { id: string; status: string; updated_at: string | null; filename: string }
        | null
      const existingAge = existingDoc?.updated_at ? Date.now() - Date.parse(existingDoc.updated_at) : 0
      const staleProcessing =
        existingDoc?.status === 'processing' && existingAge > STALE_PROCESSING_MS
      const staleUploading =
        existingDoc?.status === 'uploading' && existingAge > STALE_UPLOADING_MS
      const failed = existingDoc?.status === 'failed'

      if (existingDoc && !replace && !staleProcessing && !staleUploading && !failed) {
        if (conversationId) {
          const attached = await attachDocument(supabase, existingDoc.id, conversationId, userId)
          if (!attached) {
            sendError(res, new HttpError(500, 'db_error', 'Failed to attach the existing document.'))
            return
          }
        }
        sendJson(res, 200, {
          documentId: existingDoc.id,
          status: existingDoc.status,
          chunks: 0,
          duplicate: true,
        })
        return
      }

      if (existingDoc) {
        await removeDocumentChunks(supabase, existingDoc.id, userId)
        const { error: deleteDocErr } = await supabase
          .from('documents')
          .delete()
          .eq('id', existingDoc.id)
          .eq('user_id', userId)
        if (deleteDocErr) {
          sendError(res, new HttpError(500, 'db_error', 'Failed to replace the existing document.'))
          return
        }
        await removeDocumentObject(
          config,
          supabase,
          documentObjectPath(userId, existingDoc.id, existingDoc.filename),
        )
      }

      const { data: doc, error: docErr } = await supabase
        .from('documents')
        .insert({
          user_id: userId,
          filename: file.filename,
          mime_type: contentType,
          size_bytes: file.buffer.length,
          status: 'uploading',
          error_message: null,
          conversation_id: conversationId,
        } as any)
        .select('id')
        .single()
      if (docErr || !doc) {
        sendError(res, new HttpError(500, 'db_error', 'Failed to create document record.'))
        return
      }
      const docId = (doc as any).id as string

      if (conversationId) {
        const attached = await attachDocument(supabase, docId, conversationId, userId)
        if (!attached) {
          await markDocumentFailed(supabase, docId, userId, 'Could not attach the document.')
          sendError(res, new HttpError(500, 'db_error', 'Failed to attach the document.'))
          return
        }
      }

      const objectPath = documentObjectPath(userId, docId, file.filename)
      try {
        await uploadDocumentObject(config, supabase, objectPath, file.buffer, contentType)
      } catch (error) {
        await markDocumentFailed(
          supabase,
          docId,
          userId,
          `Could not store the file in Supabase Storage. ${errorMessage(error)}`,
        )
        sendError(
          res,
          new HttpError(
            502,
            'storage_failed',
            `Could not store the file in Supabase Storage. ${errorMessage(error)}`,
          ),
        )
        return
      }

      scheduleProcessing({
        config,
        supabase,
        documentId: docId,
        userId,
        conversationId,
        filename: file.filename,
        contentType,
        objectPath,
        buffer: file.buffer,
        claim: true,
        expectedStatus: 'uploading',
      })

      sendJson(res, 202, { documentId: docId, chunks: 0, status: 'uploading' })
      return
    } catch (error: any) {
      if (error?.message === 'too_large') {
        sendError(res, new HttpError(413, 'too_large', 'Request body too large.'))
        return
      }
      sendError(res, new HttpError(400, 'invalid_request', 'Invalid upload.'))
      return
    }
  }

  // GET /api/documents
  if (req.method === 'GET' && path === '/api/documents') {
    const { data, error } = await supabase
      .from('documents')
      .select(
        'id,filename,mime_type,size_bytes,page_count,status,error_message,conversation_id,created_at,updated_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) {
      sendError(res, new HttpError(500, 'db_error', 'Failed to load documents.'))
      return
    }

    const { data: attachments, error: attachmentsError } = await supabase
      .from('document_attachments')
      .select('document_id,conversation_id')
      .eq('user_id', userId)

    const attachmentMap = new Map<string, string[]>()
    if (!attachmentsError) {
      for (const row of (attachments ?? []) as Array<{
        document_id: string
        conversation_id: string
      }>) {
        const list = attachmentMap.get(row.document_id) ?? []
        list.push(row.conversation_id)
        attachmentMap.set(row.document_id, list)
      }
    }

    const documents = ((data ?? []) as Array<Record<string, unknown>>).map((document) => {
      const id = String(document.id)
      const existing = attachmentMap.get(id)
      const legacyConversation =
        typeof document.conversation_id === 'string' ? [document.conversation_id] : []
      return {
        ...document,
        conversation_ids: existing ?? legacyConversation,
      }
    })

    sendJson(res, 200, { documents })
    return
  }

  // POST /api/documents/:id/attach
  const attachMatch = path.match(/^\/api\/documents\/([^/]+)\/attach$/)
  if (attachMatch && req.method === 'POST') {
    const documentId = attachMatch[1]!
    const body = await readJsonBody(req, 64 * 1024)
    if (!body.ok) {
      sendError(res, body.error ?? new HttpError(400, 'invalid_body', 'Invalid request body.'))
      return
    }
    const payload = (body.value ?? {}) as Record<string, unknown>
    const conversationId =
      typeof payload.conversationId === 'string' ? payload.conversationId.trim() : ''
    if (!isUuid(documentId) || !isUuid(conversationId)) {
      sendError(res, new HttpError(400, 'invalid_request', 'documentId and conversationId must be UUIDs.'))
      return
    }
    if (!(await getOwnedConversation(supabase, conversationId, userId))) {
      sendError(res, new HttpError(404, 'not_found', 'Conversation not found.'))
      return
    }
    const { data: doc } = await supabase
      .from('documents')
      .select('id')
      .eq('id', documentId)
      .eq('user_id', userId)
      .maybeSingle()
    if (!doc) {
      sendError(res, new HttpError(404, 'not_found', 'Document not found.'))
      return
    }
    if (!(await attachDocument(supabase, documentId, conversationId, userId))) {
      sendError(res, new HttpError(500, 'db_error', 'Failed to attach the document.'))
      return
    }
    sendJson(res, 200, { ok: true })
    return
  }

  // DELETE /api/documents/:id/attach?conversationId=...
  if (attachMatch && req.method === 'DELETE') {
    const documentId = attachMatch[1]!
    const conversationId = searchParams.get('conversationId')?.trim() ?? ''
    if (!isUuid(documentId) || !isUuid(conversationId)) {
      sendError(res, new HttpError(400, 'invalid_request', 'documentId and conversationId must be UUIDs.'))
      return
    }
    const { error } = await supabase
      .from('document_attachments')
      .delete()
      .eq('document_id', documentId)
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
    if (error) {
      sendError(res, new HttpError(500, 'db_error', 'Failed to detach the document.'))
      return
    }
    sendJson(res, 200, { ok: true })
    return
  }

  // POST /api/documents/:id/debug
  const debugMatch = path.match(/^\/api\/documents\/([^/]+)\/debug$/)
  if (debugMatch && req.method === 'POST') {
    const documentId = debugMatch[1]!
    if (!isUuid(documentId)) {
      sendError(res, new HttpError(400, 'invalid_request', 'Invalid document id.'))
      return
    }

    const body = await readJsonBody(req, 16 * 1024)
    if (!body.ok) {
      sendError(res, body.error ?? new HttpError(400, 'invalid_body', 'Invalid request body.'))
      return
    }
    const payload = (body.value ?? {}) as Record<string, unknown>
    const query =
      typeof payload.query === 'string' && payload.query.trim().length > 0
        ? payload.query.trim()
        : 'What is this document about?'
    if (query.length > 500) {
      sendError(res, new HttpError(400, 'invalid_request', 'query must be 500 characters or fewer.'))
      return
    }

    const rawConversationId =
      typeof payload.conversationId === 'string' ? payload.conversationId.trim() : ''
    if (rawConversationId && !isUuid(rawConversationId)) {
      sendError(res, new HttpError(400, 'invalid_request', 'conversationId must be a UUID.'))
      return
    }
    if (
      rawConversationId &&
      !(await getOwnedConversation(supabase, rawConversationId, userId))
    ) {
      sendError(res, new HttpError(404, 'not_found', 'Conversation not found.'))
      return
    }

    const { data: docData, error: docErr } = await (supabase.from('documents') as any)
      .select('id,filename,status,page_count,error_message,conversation_id')
      .eq('id', documentId)
      .eq('user_id', userId)
      .maybeSingle()
    if (docErr) {
      sendError(res, new HttpError(500, 'db_error', 'Failed to load the document.'))
      return
    }
    const doc = docData as
      | {
          id: string
          filename: string
          status: string
          page_count: number | null
          error_message: string | null
          conversation_id: string | null
        }
      | null
    if (!doc) {
      sendError(res, new HttpError(404, 'not_found', 'Document not found.'))
      return
    }

    const { count, error: countErr } = await supabase
      .from('document_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId)
      .eq('user_id', userId)
    if (countErr) {
      sendError(res, new HttpError(500, 'db_error', 'Failed to count document chunks.'))
      return
    }

    const { data: sample, error: sampleErr } = await supabase
      .from('document_chunks')
      .select('embedding')
      .eq('document_id', documentId)
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()
    if (sampleErr) {
      sendError(res, new HttpError(500, 'db_error', 'Failed to inspect document embeddings.'))
      return
    }

    const effectiveQuery = expandVagueDocumentQuestion(query)
    let retrieved: Awaited<ReturnType<typeof retrieveRelevantChunks>> = []
    let retrievalError: string | null = null
    try {
      const chunks = await retrieveRelevantChunks(
        effectiveQuery,
        userId,
        config,
        {
          topK: Math.max(config.ragMaxContextChunks, 8),
          threshold: 0,
          documentIds: [documentId],
          conversationId: rawConversationId || null,
        },
        accessToken,
      )
      retrieved = chunks
    } catch (error) {
      retrievalError = errorMessage(error).slice(0, 300)
      ragDebugError('document.debug_retrieval_failed', error)
    }

    const relevant = retrieved
      .filter((chunk) => chunk.similarity >= config.ragSimilarityThreshold)
      .slice(0, config.ragMaxContextChunks)
    const { prompt, citations } = buildRagPrompt(effectiveQuery, relevant, 'document')
    const chunkRows = relevant.map((chunk) => ({
      chunk_id: chunk.chunk_id,
      page_number: chunk.page_number,
      similarity: Number(chunk.similarity.toFixed(4)),
    }))

    ragDebug('document.debug', {
      document: shortId(documentId),
      chunks: count ?? 0,
      candidates: retrieved.length,
      relevant: relevant.length,
      context_chars: relevant.reduce((total, chunk) => total + chunk.content.length, 0),
      prompt_chars: prompt.length,
      retrieval_error: Boolean(retrievalError),
    })

    sendJson(res, 200, {
      document: {
        id: doc.id,
        filename: doc.filename,
        status: doc.status,
        page_count: doc.page_count,
        error_message: doc.error_message,
        conversation_id: doc.conversation_id,
      },
      query: effectiveQuery,
      chunk_count: count ?? 0,
      embedding_dimensions: embeddingDimensions(
        (sample as { embedding?: unknown } | null)?.embedding,
      ),
      threshold: config.ragSimilarityThreshold,
      retrieval_top_k: Math.max(config.ragMaxContextChunks, 8),
      candidates: retrieved.length,
      relevant_count: relevant.length,
      citations: citations.length,
      chunk_ids: chunkRows,
      pages: [...new Set(relevant.map((chunk) => chunk.page_number).filter(Boolean))],
      context_chars: relevant.reduce((total, chunk) => total + chunk.content.length, 0),
      prompt_chars: prompt.length,
      would_reach_llm: relevant.length > 0,
      retrieval_error: retrievalError,
    })
    return
  }

  // GET /api/documents/:id/link
  const linkMatch = path.match(/^\/api\/documents\/([^/]+)\/link$/)
  if (linkMatch && req.method === 'GET') {
    const documentId = linkMatch[1]!
    if (!isUuid(documentId)) {
      sendError(res, new HttpError(400, 'invalid_request', 'Invalid document id.'))
      return
    }
    const { data: doc } = await supabase
      .from('documents')
      .select('id,filename')
      .eq('id', documentId)
      .eq('user_id', userId)
      .maybeSingle()
    if (!doc) {
      sendError(res, new HttpError(404, 'not_found', 'Document not found.'))
      return
    }
    const filename = (doc as { filename: string }).filename
    try {
      const url = await createSignedDocumentUrl(
        config,
        supabase,
        documentObjectPath(userId, documentId, filename),
      )
      sendJson(res, 200, { url, filename })
    } catch (error) {
      sendError(
        res,
        new HttpError(
          502,
          'storage_failed',
          `Could not create a document link. ${errorMessage(error)}`,
        ),
      )
    }
    return
  }

  // DELETE /api/documents/:id
  const match = path.match(/^\/api\/documents\/([^/]+)$/)
  if (match && req.method === 'DELETE') {
    const id = match[1]!
    const { data: doc } = await (supabase.from('documents') as any)
      .select('filename')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle()
    await removeDocumentChunks(supabase, id, userId)
    const { error } = await supabase.from('documents').delete().eq('id', id).eq('user_id', userId)
    if (error) {
      sendError(res, new HttpError(500, 'db_error', 'Failed to delete document.'))
      return
    }
    if ((doc as any)?.filename) {
      await removeDocumentObject(
        config,
        supabase,
        documentObjectPath(userId, id, (doc as any).filename),
      )
    }
    sendJson(res, 200, { ok: true })
    return
  }

  // POST /api/documents/:id/reindex
  const reindexMatch = path.match(/^\/api\/documents\/([^/]+)\/reindex$/)
  if (reindexMatch && req.method === 'POST') {
    const id = reindexMatch[1]!
    if (!isUuid(id)) {
      sendError(res, new HttpError(400, 'invalid_request', 'Invalid document id.'))
      return
    }

    const { data: docData, error: docErr } = await (supabase.from('documents') as any)
      .select('id,filename,mime_type,status,conversation_id,updated_at')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle()
    if (docErr) {
      sendError(res, new HttpError(500, 'db_error', 'Failed to load the document.'))
      return
    }
    const doc = docData as
      | {
          id: string
          filename: string
          mime_type: string | null
          status: string
          conversation_id: string | null
          updated_at: string | null
        }
      | null
    if (!doc) {
      sendError(res, new HttpError(404, 'not_found', 'Document not found.'))
      return
    }

    const age = doc.updated_at ? Date.now() - Date.parse(doc.updated_at) : 0
    if (
      (doc.status === 'processing' && age <= STALE_PROCESSING_MS) ||
      (doc.status === 'uploading' && age <= STALE_UPLOADING_MS)
    ) {
      sendError(res, new HttpError(409, 'processing', 'Document is already processing.'))
      return
    }

    const { error: processingErr } = await (supabase.from('documents') as any)
      .update({ status: 'processing', error_message: null })
      .eq('id', id)
      .eq('user_id', userId)
    if (processingErr) {
      sendError(res, new HttpError(500, 'db_error', 'Failed to start reindexing.'))
      return
    }

    scheduleProcessing({
      config,
      supabase,
      documentId: id,
      userId,
      conversationId: doc.conversation_id,
      filename: doc.filename,
      contentType: doc.mime_type ?? '',
      objectPath: documentObjectPath(userId, id, doc.filename),
      claim: false,
    })

    sendJson(res, 202, {
      documentId: id,
      chunks: 0,
      status: 'processing',
      reindexed: true,
    })
    return
  }

  sendError(res, new HttpError(404, 'not_found', 'Unknown route.'))
}
