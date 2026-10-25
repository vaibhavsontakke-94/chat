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
  keyword_score?: number
  score?: number
}

export interface RetrieveOptions {
  topK?: number
  threshold?: number
  relativeThreshold?: number
  documentId?: string | null
  documentIds?: string[]
  conversationId?: string | null
  queryVariants?: string[]
  candidateCount?: number
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
  keyword_score?: number
}

interface RawVector {
  id: string
  embedding: unknown
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
    keyword_score: typeof row.keyword_score === 'number' ? row.keyword_score : undefined,
  }))
}

function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === 'PGRST202') return true
  return /could not find the function|schema cache/i.test(error.message ?? '')
}

export function filterRetrievedChunks(
  chunks: RetrievedChunk[],
  opts: {
    documentIds?: string[]
    threshold?: number
    relativeThreshold?: number
    topK?: number
  } = {},
): RetrievedChunk[] {
  const documentIds = opts.documentIds ?? []
  const threshold = opts.threshold ?? 0.2
  const topK = opts.topK ?? 5
  const scoped =
    documentIds.length > 0
      ? chunks.filter((chunk) => documentIds.includes(chunk.document_id))
      : chunks

  const bySimilarity = [...scoped].sort((a, b) => b.similarity - a.similarity)
  const bestSimilarity = bySimilarity[0]?.similarity ?? 0
  const relativeFloor = opts.relativeThreshold
    ? Math.max(threshold, bestSimilarity * opts.relativeThreshold)
    : threshold

  const relevant = scoped
    .filter((chunk) => chunk.similarity >= relativeFloor || (chunk.keyword_score ?? 0) > 0.15)
    .sort((a, b) => {
      const left = b.score ?? b.similarity
      const right = a.score ?? a.similarity
      return left - right
    })

  if (relevant.length > 0) return relevant.slice(0, topK)
  return bySimilarity.filter((chunk) => chunk.similarity >= threshold).slice(0, topK)
}

function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
    return value as number[]
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'number')) {
        return parsed as number[]
      }
    } catch {
      return null
    }
  }
  return null
}

function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < length; i++) {
    const left = a[i] as number
    const right = b[i] as number
    dot += left * right
    normA += left * left
    normB += right * right
  }
  if (normA === 0 || normB === 0) return 0
  return dot / Math.sqrt(normA * normB)
}

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'this',
  'that',
  'these',
  'those',
  'what',
  'which',
  'who',
  'whom',
  'how',
  'why',
  'when',
  'where',
  'does',
  'do',
  'did',
  'can',
  'could',
  'should',
  'would',
  'please',
  'explain',
  'describe',
  'answer',
  'question',
  'according',
  'document',
  'pdf',
  'from',
  'about',
  'give',
  'tell',
  'me',
])

function keywordQuery(query: string): string {
  const tokens = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (token) => token.length > 1 && !STOP_WORDS.has(token),
  )
  const unique = Array.from(new Set(tokens)).slice(0, 12)
  return unique.join(' OR ')
}

function buildQueryVariants(query: string, extra: string[] = []): string[] {
  const variants = [query, ...extra]
  const compact = keywordQuery(query)
  if (compact && compact !== query.toLowerCase()) variants.push(compact)

  const unique: string[] = []
  const seen = new Set<string>()
  for (const variant of variants) {
    const trimmed = variant.trim()
    const key = trimmed.toLowerCase()
    if (trimmed.length < 2 || seen.has(key)) continue
    seen.add(key)
    unique.push(trimmed)
    if (unique.length >= 3) break
  }
  return unique
}

function fuseResults(
  vectorLists: RetrievedChunk[][],
  keywordLists: RetrievedChunk[][],
): RetrievedChunk[] {
  const merged = new Map<string, { chunk: RetrievedChunk; score: number }>()
  const rrf = (rank: number) => 1 / (60 + rank)

  vectorLists.forEach((list) => {
    list.forEach((chunk, rank) => {
      const existing = merged.get(chunk.chunk_id)
      const contribution = rrf(rank)
      if (existing) {
        existing.score += contribution
        existing.chunk.similarity = Math.max(existing.chunk.similarity, chunk.similarity)
      } else {
        merged.set(chunk.chunk_id, { chunk: { ...chunk }, score: contribution })
      }
    })
  })

  keywordLists.forEach((list) => {
    list.forEach((chunk, rank) => {
      const existing = merged.get(chunk.chunk_id)
      const contribution = rrf(rank) * 0.8
      if (existing) {
        existing.score += contribution
        existing.chunk.keyword_score = Math.max(
          existing.chunk.keyword_score ?? 0,
          chunk.keyword_score ?? 0,
        )
      } else {
        merged.set(chunk.chunk_id, {
          chunk: { ...chunk, similarity: 0 },
          score: contribution,
        })
      }
    })
  })

  const fused = Array.from(merged.values())
    .map((entry) => ({ ...entry.chunk, score: entry.score }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  const maxScore = fused[0]?.score ?? 0
  if (maxScore > 0) {
    for (const chunk of fused) chunk.score = (chunk.score ?? 0) / maxScore
  }
  return fused
}

async function hydrateKeywordSimilarity(
  chunks: RetrievedChunk[],
  queryEmbedding: number[],
  config: AppConfig,
  accessToken: string,
): Promise<void> {
  const missing = chunks.filter((chunk) => chunk.similarity <= 0)
  if (missing.length === 0) return

  const supabase = getUserSupabase(config, accessToken)
  const { data, error } = await supabase
    .from('document_chunks')
    .select('id, embedding')
    .in(
      'id',
      missing.map((chunk) => chunk.chunk_id),
    )

  if (error || !Array.isArray(data)) {
    ragDebugError('retrieval.keyword_hydrate_failed', error)
    return
  }

  const byId = new Map<string, number[]>()
  for (const row of data as RawVector[]) {
    const vector = parseEmbedding(row.embedding)
    if (vector) byId.set(row.id, vector)
  }

  for (const chunk of missing) {
    const vector = byId.get(chunk.chunk_id)
    if (vector) chunk.similarity = cosine(queryEmbedding, vector)
  }
}

export async function retrieveRelevantChunks(
  query: string,
  _userId: string,
  config: AppConfig,
  opts: RetrieveOptions = {},
  accessToken: string,
): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? config.ragMaxContextChunks
  const threshold = opts.threshold ?? config.ragSimilarityThreshold
  const documentIds = (opts.documentIds ?? []).filter(Boolean)
  const hasDocumentScope =
    documentIds.length > 0 || (opts.documentId != null && opts.documentId !== '')
  const candidateCount = Math.max(
    opts.candidateCount ?? config.ragCandidateCount,
    topK * 3,
    10,
  )
  const variants = buildQueryVariants(query, opts.queryVariants)

  ragDebug('retrieval.start', {
    query_length: query.length,
    variants: variants.length,
    top_k: topK,
    threshold,
    document_count: documentIds.length + (opts.documentId ? 1 : 0),
    conversation: shortId(opts.conversationId),
  })

  const embeddings = await embedText(variants, config, { taskType: 'query' })
  ragDebug('retrieval.query_embedding', {
    variants: embeddings.length,
    dimensions: embeddings[0]?.length ?? 0,
  })

  const supabase = getUserSupabase(config, accessToken)
  const matchCount = hasDocumentScope ? Math.max(candidateCount, 30) : candidateCount
  const keywordCount = Math.max(12, Math.ceil(topK * 2))

  const vectorLists: RetrievedChunk[][] = []
  const keywordLists: RetrievedChunk[][] = []

  for (let index = 0; index < variants.length; index++) {
    const variant = variants[index] as string
    const queryEmbedding = embeddings[index]
    if (!queryEmbedding) continue

    const { data, error } = await supabase.rpc('match_document_chunks_scoped', {
      query_embedding: queryEmbedding,
      match_count: matchCount,
      filter_document_id: opts.documentId ?? null,
      filter_document_ids: documentIds.length > 0 ? documentIds : null,
      filter_conversation_id: opts.conversationId ?? null,
    } as never)

    if (isMissingFunction(error)) {
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
      vectorLists.push(mapChunks(fallback.data))
    } else if (error) {
      ragDebugError('retrieval.rpc_failed', error)
      throw error
    } else {
      vectorLists.push(mapChunks(data))
    }

    const keyword = keywordQuery(variant)
    if (keyword.length < 2) continue
    const keywordResponse = await supabase.rpc('search_document_chunks_keyword', {
      query_text: keyword,
      match_count: keywordCount,
      filter_document_id: opts.documentId ?? null,
      filter_document_ids: documentIds.length > 0 ? documentIds : null,
      filter_conversation_id: opts.conversationId ?? null,
    } as never)

    if (keywordResponse.error) {
      if (!isMissingFunction(keywordResponse.error)) {
        ragDebugError('retrieval.keyword_failed', keywordResponse.error)
      }
    } else {
      keywordLists.push(mapChunks(keywordResponse.data))
    }
  }

  const fused = fuseResults(vectorLists, keywordLists)
  await hydrateKeywordSimilarity(fused, embeddings[0] ?? [], config, accessToken)

  const relevant = filterRetrievedChunks(fused, {
    documentIds,
    threshold,
    relativeThreshold: opts.relativeThreshold,
    topK,
  })

  ragDebug('retrieval.results', {
    variants: variants.length,
    candidates: fused.length,
    relevant: relevant.length,
    top_chunks: relevant.slice(0, 8).map(
      (chunk) =>
        `${chunk.chunk_id.slice(0, 8)}:p${chunk.page_number ?? '-'}:${chunk.similarity.toFixed(3)}` +
        (chunk.keyword_score ? `:k${chunk.keyword_score.toFixed(2)}` : ''),
    ),
  })

  return relevant
}
