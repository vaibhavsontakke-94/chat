import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AppConfig } from '../../config.ts'
import { getAuthUser } from '../../middleware/auth.ts'
import { getServiceSupabase } from '../../lib/supabase/service.ts'
import { getStorageClient, DOCUMENTS_BUCKET } from '../../lib/storage/client.ts'
import { HttpError, sendError, sendJson } from '../../lib/http.ts'
import { extractPdf } from '../../lib/ingest/pdf.ts'
import { chunkPages } from '../../lib/ingest/chunker.ts'
import { embedText } from '../../lib/ingest/embeddings.ts'

const MAX_PDF_BYTES = 25 * 1024 * 1024
const MAX_PAGES = 50

function getUserId(req: IncomingMessage, config: AppConfig): string | null {
  const user = getAuthUser(req, config)
  return user?.id ?? null
}

function parseMultipart(req: IncomingMessage, maxBytes: number): Promise<{ fields: Record<string,string>, file?: { filename: string, contentType: string, buffer: Buffer } }> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || ''
    const boundaryMatch = contentType.match(/boundary=(.+)$/)
    if (!boundaryMatch) return reject(new Error('invalid_multipart'))
    const boundary = '--' + boundaryMatch[1]
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        req.destroy()
        return reject(new Error('too_large'))
      }
      chunks.push(Buffer.from(chunk))
    })
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks)
        const bodyStr = body.toString('latin1')
        const parts = bodyStr.split(boundary)
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

export async function handleDocuments(
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
  const storage = getStorageClient(config)

  // POST /api/documents/upload
  if (req.method === 'POST' && path === '/api/documents/upload') {
    try {
      const parsed = await parseMultipart(req, MAX_PDF_BYTES + 1024)
      const file = parsed.file
      if (!file) {
        sendError(res, new HttpError(400, 'invalid_request', 'No file uploaded.'))
        return
      }
      const lower = file.filename.toLowerCase()
      if (!lower.endsWith('.pdf')) {
        sendError(res, new HttpError(400, 'invalid_type', 'Only PDF files are allowed.'))
        return
      }
      if (file.buffer.length > MAX_PDF_BYTES) {
        sendError(res, new HttpError(413, 'too_large', 'File exceeds 25MB limit.'))
        return
      }

      // Create document record
      const { data: doc, error: docErr } = await supabase
        .from('documents')
        .insert({ user_id: userId, filename: file.filename, mime_type: file.contentType || 'application/pdf', size_bytes: file.buffer.length, status: 'processing' } as any)
        .select('id')
        .single()
      if (docErr || !doc) {
        sendError(res, new HttpError(500, 'db_error', 'Failed to create document record.'))
        return
      }
      const docId = (doc as any).id

      // Upload to private bucket (best effort)
      try {
        await storage.storage.from(DOCUMENTS_BUCKET).upload(`${userId}/${docId}/${file.filename}`, file.buffer, { contentType: file.contentType || 'application/pdf', upsert: false })
      } catch {
        // continue even if storage upload fails; we can still process text
      }

      // Extract and chunk
      let extracted
      try {
        extracted = await extractPdf(file.buffer)
      } catch {
      await (supabase.from('documents') as any).update({ status: 'error' }).eq('id', docId).eq('user_id', userId)
      sendError(res, new HttpError(400, 'extract_failed', 'Failed to extract text from PDF. The file may be scanned or malformed.'))
      return
    }

    if (extracted.numpages > MAX_PAGES) {
      await supabase.from('documents').delete().eq('id', docId).eq('user_id', userId)
      sendError(res, new HttpError(400, 'too_many_pages', `PDF has too many pages (max ${MAX_PAGES}).`))
      return
    }

    const pages = extracted.pages.length > 0 ? extracted.pages : [{ pageNumber: 1, text: extracted.text }]
    const chunks = chunkPages(pages, { chunkSize: 1000, overlap: 200 })
    if (chunks.length === 0 || extracted.text.trim().length === 0) {
      await (supabase.from('documents') as any).update({ status: 'error' }).eq('id', docId).eq('user_id', userId)
      sendError(res, new HttpError(400, 'empty_pdf', 'No extractable text found. This may be a scanned PDF (OCR not supported).'))
      return
    }

    // Embed
    try {
      const texts = chunks.map((c: any) => c.content)
      const embeddings = await embedText(texts, config)
      const rows = chunks.map((c: any, i: number) => ({
        document_id: docId,
        user_id: userId,
        chunk_index: c.index,
        page_number: c.pageNumber,
        content: c.content,
        embedding: embeddings[i],
      }))
      // Insert in batches
      const batchSize = 50
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize)
        const { error: insErr } = await (supabase.from('document_chunks') as any).insert(batch)
        if (insErr) throw insErr
      }
      await (supabase.from('documents') as any).update({ status: 'ready', page_count: extracted.numpages }).eq('id', docId).eq('user_id', userId)
        sendJson(res, 200, { documentId: docId, chunks: chunks.length, status: 'ready' })
        return
      } catch (e: any) {
        // cleanup partial
        try { await supabase.from('document_chunks').delete().eq('document_id', docId).eq('user_id', userId) } catch {}
        try { await supabase.from('documents').delete().eq('id', docId).eq('user_id', userId) } catch {}
        try { await storage.storage.from(DOCUMENTS_BUCKET).remove([`${userId}/${docId}/${file.filename}`]) } catch {}
        sendError(res, new HttpError(500, 'ingest_failed', e?.message || 'Ingestion failed.'))
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
      .select('id,filename,mime_type,size_bytes,page_count,status,created_at,updated_at')
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
    // get filename
    const { data: doc } = await supabase.from('documents').select('filename').eq('id', id).eq('user_id', userId).maybeSingle()
    try { await supabase.from('document_chunks').delete().eq('document_id', id).eq('user_id', userId) } catch {}
    const { error } = await supabase.from('documents').delete().eq('id', id).eq('user_id', userId)
    if ((doc as any)?.filename) {
      try { await storage.storage.from(DOCUMENTS_BUCKET).remove([`${userId}/${id}/${(doc as any).filename}`]) } catch {}
    }
    if (error) {
      sendError(res, new HttpError(500, 'db_error', 'Failed to delete document.'))
      return
    }
    sendJson(res, 200, { ok: true })
    return
  }

  sendError(res, new HttpError(404, 'not_found', 'Unknown route.'))
}
