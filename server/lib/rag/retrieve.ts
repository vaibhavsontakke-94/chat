import type { AppConfig } from '../../config.ts'
import { getEmbedModel, getOllamaBaseUrl } from '../ingest/embeddings.ts'
import { getServiceSupabase } from '../supabase/service.ts'

export interface RetrievedChunk {
  chunk_id: string
  document_id: string
  filename: string
  page_number: number | null
  chunk_index: number
  content: string
  similarity: number
}

export async function retrieveRelevantChunks(
  query: string,
  _userId: string,
  config: AppConfig,
  opts: { topK?: number; threshold?: number; documentId?: string | null } = {},
): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? 5
  const threshold = opts.threshold ?? 0.2
  const baseUrl = getOllamaBaseUrl(config)
  const model = getEmbedModel(config)

  // Embed question with same model
  const res = await fetch(`${baseUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: query }),
  })
  if (!res.ok) throw new Error('Failed to embed question')
  const json = (await res.json()) as { embedding?: number[] }
  if (!Array.isArray(json.embedding)) throw new Error('Invalid embedding')

  const supabase = getServiceSupabase(config)
  const { data, error } = await supabase.rpc('match_document_chunks', {
    query_embedding: json.embedding,
    match_count: Math.max(topK, 10),
    filter_document_id: opts.documentId ?? null,
  } as any)
  if (error) throw error

  const chunks: RetrievedChunk[] = ((data as any[]) || []).map((row: any) => ({
    chunk_id: row.chunk_id,
    document_id: row.document_id,
    filename: row.filename,
    page_number: row.page_number,
    chunk_index: row.chunk_index,
    content: row.content,
    similarity: typeof row.similarity === 'number' ? row.similarity : 0,
  }))

  // Filter by threshold and take topK
  return chunks.filter((c) => c.similarity >= threshold).slice(0, topK)
}
