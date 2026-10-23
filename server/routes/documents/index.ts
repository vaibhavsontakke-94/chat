import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AppConfig } from '../../config.ts'
import { getAuthUser, getBearerToken } from '../../middleware/auth.ts'
import { getUserSupabase } from '../../lib/supabase/user.ts'
import { getStorageClientWithBucket, DOCUMENTS_BUCKET } from '../../lib/storage/client.ts'
import { HttpError } from '../../lib/errors.ts'
import { sendError, sendJson } from '../../lib/http.ts'
import { extractPdf } from '../../lib/ingest/pdf.ts'
import { chunkPages } from '../../lib/ingest/chunker.ts'
import { embedText } from '../../lib/ingest/embeddings.ts'
import { isUuid } from '../../lib/validate.ts'

const MAX_PDF_BYTES = 25 * 1024 * 1024
const MAX_MULTIPART_BYTES = MAX_PDF_BYTES + 64 * 1024
const MAX_PAGES = 50

async function getUserId(req: IncomingMessage, config: AppConfig): Promise<string | null> {
  const user = await getAuthUser(req, config)
  return user?.id ?? null
}

function safeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'document.pdf'
  const cleaned = base.replace(/[^\w.\- ]+/g, '_').trim()
  return cleaned.length > 0 ? cleaned.slice(0, 180) : 'document.pdf'
}

function parseMultipart(req: IncomingMessage, maxBytes: number): Promise<{ fields: Record<string,string>, file?: { filename: string, contentType: string, buffer: Buffer } }> {
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
        const fields: Record<string,string> = {}
        let file: { filename: string, contentType: string, buffer: Buffer } | undefined
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

async function markDocumentError(
  supabase: ReturnType<typeof getUserSupabase>,
  documentId: string,
  userId: string,
): Promise<void> {
  try {
    await (supabase.from('documents') as any)
      .update({ status: 'error' })
      .eq('id', documentId)
      .eq('user_id', userId)
  } catch {
    // The original error is more useful than a failed status update.
  }
}

async function uploadDocumentObject(
  config: AppConfig,
  userClient: ReturnType<typeof getUserSupabase>,
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

async function removeDocumentObject(
  config: AppConfig,
  userClient: ReturnType<typeof getUserSupabase>,
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

export async function handleDocuments(
  req: IncomingMessage,
  res: ServerResponse,
  config: AppConfig,
  path: string,
): Promise<void> {
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
      const lower = file.filename.toLowerCase()
      if (!lower.endsWith('.pdf')) {
        sendError(res, new HttpError(415, 'invalid_type', 'Only PDF files are allowed.'))
        return
      }
      if (file.buffer.length > MAX_PDF_BYTES) {
        sendError(res, new HttpError(413, 'too_large', 'File exceeds 25MB limit.'))
        return
      }
      if (file.buffer.length === 0 || !file.buffer.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
        sendError(res, new HttpError(415, 'invalid_type', 'The uploaded file is not a valid PDF.'))
        return
      }

      const contentType = file.contentType.toLowerCase().startsWith('application/pdf')
        ? file.contentType
        : 'application/pdf'

      const rawConversationId = parsed.fields.conversationId ?? parsed.fields.conversation_id
      let conversationId: string | null = null
      if (typeof rawConversationId === 'string' && rawConversationId.trim().length > 0) {
        if (!isUuid(rawConversationId.trim())) {
          sendError(res, new HttpError(400, 'invalid_request', 'conversationId must be a UUID.'))
          return
        }
        const { data: conversation } = await supabase
          .from('conversations')
          .select('id')
          .eq('id', rawConversationId.trim())
          .eq('user_id', userId)
          .maybeSingle()
        if (!conversation) {
          sendError(res, new HttpError(404, 'not_found', 'Conversation not found.'))
          return
        }
        conversationId = rawConversationId.trim()
      }

      const { data: existing, error: existingErr } = await (supabase.from('documents') as any)
        .select('id,status')
        .eq('user_id', userId)
        .eq('filename', file.filename)
        .eq('size_bytes', file.buffer.length)
        .in('status', ['processing', 'ready'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (existingErr) {
        sendError(res, new HttpError(500, 'db_error', 'Failed to check for duplicate documents.'))
        return
      }
      if (existing) {
        sendJson(res, 200, {
          documentId: existing.id,
          status: existing.status,
          chunks: 0,
          duplicate: true,
        })
        return
      }

      // Create the document record first so the storage path can use its id.
      const { data: doc, error: docErr } = await supabase
        .from('documents')
        .insert({
          user_id: userId,
          filename: file.filename,
          mime_type: contentType,
          size_bytes: file.buffer.length,
          status: 'processing',
          conversation_id: conversationId,
        } as any)
        .select('id')
        .single()
      if (docErr || !doc) {
        sendError(res, new HttpError(500, 'db_error', 'Failed to create document record.'))
        return
      }
      const docId = (doc as any).id
      const objectPath = `${userId}/${docId}/${safeFilename(file.filename)}`

      try {
        await uploadDocumentObject(config, supabase, objectPath, file.buffer, contentType)
      } catch (error) {
        await markDocumentError(supabase, docId, userId)
        sendError(
          res,
          new HttpError(
            502,
            'storage_failed',
            `Could not store the PDF in Supabase Storage. ${error instanceof Error ? error.message : 'Check the documents bucket.'}`,
          ),
        )
        return
      }

      let extracted
      try {
        extracted = await extractPdf(file.buffer)
      } catch {
        await markDocumentError(supabase, docId, userId)
        await removeDocumentObject(config, supabase, objectPath)
        sendError(res, new HttpError(422, 'extract_failed', 'Failed to extract text from PDF. The file may be scanned, encrypted, or malformed.'))
        return
      }

      if (extracted.numpages > MAX_PAGES) {
        await markDocumentError(supabase, docId, userId)
        await removeDocumentObject(config, supabase, objectPath)
        sendError(res, new HttpError(422, 'too_many_pages', `PDF has too many pages (max ${MAX_PAGES}).`))
        return
      }

      const pages = extracted.pages.length > 0 ? extracted.pages : [{ pageNumber: 1, text: extracted.text }]
      const chunks = chunkPages(pages, { chunkSize: 1000, overlap: 200 })
      if (chunks.length === 0 || extracted.text.trim().length === 0) {
        await markDocumentError(supabase, docId, userId)
        await removeDocumentObject(config, supabase, objectPath)
        sendError(res, new HttpError(422, 'empty_pdf', 'No extractable text found. This may be a scanned PDF (OCR is not supported).'))
        return
      }

      try {
        const texts = chunks.map((chunk) => chunk.content)
        const embeddings = await embedText(texts, config)
        if (embeddings.length !== chunks.length) {
          throw new Error('The embedding service returned an unexpected number of vectors.')
        }
        const rows = chunks.map((chunk, index) => ({
          document_id: docId,
          user_id: userId,
          conversation_id: conversationId,
          chunk_index: chunk.index,
          page_number: chunk.pageNumber,
          content: chunk.content,
          embedding: embeddings[index],
          metadata: {
            filename: file.filename,
            page_number: chunk.pageNumber,
            chunk_index: chunk.index,
          },
        }))

        const batchSize = 50
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize)
          const { error: insErr } = await (supabase.from('document_chunks') as any).insert(batch)
          if (insErr) throw new Error(insErr.message)
        }

        const { error: readyErr } = await (supabase.from('documents') as any)
          .update({ status: 'ready', page_count: extracted.numpages })
          .eq('id', docId)
          .eq('user_id', userId)
        if (readyErr) throw new Error(readyErr.message)

        sendJson(res, 200, { documentId: docId, chunks: chunks.length, status: 'ready' })
        return
      } catch (error) {
        try {
          await supabase.from('document_chunks').delete().eq('document_id', docId).eq('user_id', userId)
        } catch {
          // Ignore cleanup errors and report the ingestion failure below.
        }
        await markDocumentError(supabase, docId, userId)
        await removeDocumentObject(config, supabase, objectPath)
        sendError(
          res,
          new HttpError(
            502,
            'ingest_failed',
            `Document indexing failed. ${error instanceof Error ? error.message : 'Please try again.'}`,
          ),
        )
        return
      }
    } catch (err: any) {
      if (err?.message === 'too_large') {
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
      .select('id,filename,mime_type,size_bytes,page_count,status,conversation_id,created_at,updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) {
      sendError(res, new HttpError(500, 'db_error', 'Failed to load documents.'))
      return
    }
    sendJson(res, 200, { documents: data ?? [] })
    return
  }

  // DELETE /api/documents/:id
  const match = path.match(/^\/api\/documents\/([^/]+)$/)
  if (match && req.method === 'DELETE') {
    const id = match[1]
    const { data: doc } = await (supabase.from('documents') as any)
      .select('filename')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle()
    try {
      await supabase.from('document_chunks').delete().eq('document_id', id).eq('user_id', userId)
    } catch {
      // The cascade on documents deletion also removes chunks.
    }
    const { error } = await supabase.from('documents').delete().eq('id', id).eq('user_id', userId)
    if (error) {
      sendError(res, new HttpError(500, 'db_error', 'Failed to delete document.'))
      return
    }
    if ((doc as any)?.filename) {
      await removeDocumentObject(
        config,
        supabase,
        `${userId}/${id}/${safeFilename((doc as any).filename)}`,
      )
    }
    sendJson(res, 200, { ok: true })
    return
  }

  sendError(res, new HttpError(404, 'not_found', 'Unknown route.'))
}
