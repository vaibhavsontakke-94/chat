import type { AppConfig } from '../../config.ts'
import { embedText } from '../ingest/embeddings.ts'
import { getUserSupabase } from '../supabase/user.ts'
import { ragDebug, ragDebugError, shortId } from './debug.ts'

export interface RetrievedChunk {
  chunk_id: string
  document_id: string
  filename: string
  page_number: number | null
  chunk_index: number
  content: string
  metadata: Record<string, unknown>
  similarity: number
}

export interface RetrieveOptions {
  topK?: number
  threshold?: number
  documentId?: string | null
  documentIds?: string[]
  conversationId?: string | null
}

interface RawChunk {
  chunk_id: string
  document_id: string
  filename: string
  page_number: number | null
  chunk_index: number
  content: string
  metadata?: Record<string, unknown> | null
  similarity?: number
}

function mapChunks(rows: unknown): RetrievedChunk[] {
  return ((rows as RawChunk[] | null) ?? []).map((row) => ({
    chunk_id: row.chunk_id,
    document_id: row.document_id,
    filename: row.filename,
    page_number: row.page_number,
    chunk_index: row.chunk_index,
    content: row.content,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    similarity: typeof row.similarity === 'number' ? row.similarity : 0,
  }))
}

function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === 'PGRST202') return true
  return /could not find the function|schema cache/i.test(error.message ?? '')
}

export function filterRetrievedChunks(
  chunks: RetrievedChunk[],
  opts: { documentIds?: string[]; threshold?: number; topK?: number } = {},
): RetrievedChunk[] {
  const documentIds = opts.documentIds ?? []
  const threshold = opts.threshold ?? 0.2
  const topK = opts.topK ?? 5
  const scoped =
    documentIds.length > 0
      ? chunks.filter((chunk) => documentIds.includes(chunk.document_id))
      : chunks
  return scoped.filter((chunk) => chunk.similarity >= threshold).slice(0, topK)
}

export async function retrieveRelevantChunks(
  query: string,
  _userId: string,
  config: AppConfig,
  opts: RetrieveOptions = {},
  accessToken: string,
): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? 5
  const threshold = opts.threshold ?? 0.2
  const documentIds = (opts.documentIds ?? []).filter(Boolean)
  const hasDocumentScope =
    documentIds.length > 0 || (opts.documentId != null && opts.documentId !== '')

  ragDebug('retrieval.start', {
    query_length: query.length,
    top_k: topK,
    threshold,
    document_count: documentIds.length + (opts.documentId ? 1 : 0),
    conversation: shortId(opts.conversationId),
  })

  // Embed the question with the same provider used during ingestion.
  const [queryEmbedding] = await embedText([query], config, { taskType: 'query' })
  ragDebug('retrieval.query_embedding', {
    dimensions: queryEmbedding?.length ?? 0,
  })

  // The user-scoped client lets the security-definer RPC derive the owner from
  // auth.uid(), so a caller can never retrieve another user's chunks.
  const supabase = getUserSupabase(config, accessToken)
  const matchCount = hasDocumentScope ? Math.max(topK, 30) : Math.max(topK, 10)

  const { data, error } = await supabase.rpc('match_document_chunks_scoped', {
    query_embedding: queryEmbedding,
    match_count: matchCount,
    filter_document_id: opts.documentId ?? null,
    filter_document_ids: documentIds.length > 0 ? documentIds : null,
    filter_conversation_id: opts.conversationId ?? null,
  } as never)

  let chunks: RetrievedChunk[]

  if (isMissingFunction(error)) {
    // Deployment may not have migration 004 yet. Stay functional with the
    // original function, which is still owner-scoped, then filter in-process.
    ragDebug('retrieval.fallback_rpc', { reason: 'scoped_function_missing' })
    const fallback = await supabase.rpc('match_document_chunks', {
      query_embedding: queryEmbedding,
      match_count: matchCount,
      filter_document_id: opts.documentId ?? null,
    } as never)
    if (fallback.error) {
      ragDebugError('retrieval.fallback_failed', fallback.error)
      throw fallback.error
    }
    chunks = mapChunks(fallback.data)
  } else {
    if (error) {
      ragDebugError('retrieval.rpc_failed', error)
      throw error
    }
    chunks = mapChunks(data)
  }

  const relevant = filterRetrievedChunks(chunks, { documentIds, threshold, topK })
  ragDebug('retrieval.results', {
    candidates: chunks.length,
    relevant: relevant.length,
    top_chunks: relevant.slice(0, 8).map(
      (chunk) =>
        `${chunk.chunk_id.slice(0, 8)}:p${chunk.page_number ?? '-'}:${chunk.similarity.toFixed(3)}`,
    ),
  })

  return relevant
}
