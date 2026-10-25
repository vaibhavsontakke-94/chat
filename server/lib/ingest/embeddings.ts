import type { AppConfig } from '../../config.ts'

export const EMBEDDING_DIMENSIONS = 768
export const EMBEDDING_REVISION = 'v1-768'

export type EmbeddingProvider = 'ollama' | 'openai' | 'huggingface' | 'google' | 'local'

export interface EmbeddingConfig {
  provider: EmbeddingProvider
  model: string
  dimensions: number
  revision: string
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function getOllamaBaseUrl(_config?: AppConfig): string {
  return readEnv('OLLAMA_BASE_URL') ?? 'http://localhost:11434'
}

export function getEmbedModel(_config?: AppConfig): string {
  return readEnv('OLLAMA_EMBED_MODEL') ?? readEnv('GROQ_EMBED_MODEL') ?? 'nomic-embed-text'
}

const HF_DEFAULT_MODEL = 'sentence-transformers/all-MiniLM-L6-v2'
const GOOGLE_DEFAULT_MODEL = 'gemini-embedding-001'
const GOOGLE_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const LOCAL_MODEL = 'local-hash-v1'

function getEmbeddingProvider(): EmbeddingProvider {
  const configured = readEnv('EMBEDDINGS_PROVIDER')?.toLowerCase()
  if (
    configured === 'ollama' ||
    configured === 'openai' ||
    configured === 'huggingface' ||
    configured === 'hf' ||
    configured === 'google' ||
    configured === 'gemini' ||
    configured === 'local'
  ) {
    if (configured === 'hf') return 'huggingface'
    if (configured === 'gemini') return 'google'
    return configured
  }
  if (readEnv('EMBEDDINGS_API_URL') || readEnv('EMBEDDINGS_API_KEY') || readEnv('OPENAI_API_KEY')) {
    return 'openai'
  }
  if (readEnv('HF_TOKEN') || readEnv('HUGGINGFACE_API_KEY') || readEnv('HF_EMBEDDING_MODEL')) {
    return 'huggingface'
  }
  if (readEnv('GEMINI_API_KEY') || readEnv('GOOGLE_API_KEY')) {
    return 'google'
  }
  if (readEnv('OLLAMA_BASE_URL') || readEnv('OLLAMA_EMBED_MODEL')) {
    return 'ollama'
  }
  return 'local'
}

export function getEmbeddingConfig(): EmbeddingConfig {
  const provider = getEmbeddingProvider()
  const model =
    provider === 'google'
      ? (readEnv('GEMINI_EMBEDDING_MODEL') ?? GOOGLE_DEFAULT_MODEL).replace(/^models\//, '')
      : provider === 'huggingface'
        ? (readEnv('HF_EMBEDDING_MODEL') ?? HF_DEFAULT_MODEL)
        : provider === 'openai'
          ? (readEnv('EMBEDDINGS_MODEL') ?? 'text-embedding-3-small')
          : provider === 'ollama'
            ? getEmbedModel()
            : LOCAL_MODEL

  return {
    provider,
    model,
    dimensions: EMBEDDING_DIMENSIONS,
    revision: `${provider}:${model}:${EMBEDDING_REVISION}`,
  }
}

type EmbeddingOptions = {
  allowPadding?: boolean
  normalize?: boolean
}

export interface EmbedTextOptions {
  taskType?: 'document' | 'query'
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryDelayMs(response: Response | null, attempt: number): number {
  if (response) {
    const retryAfter = Number(response.headers.get('retry-after'))
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return Math.min(retryAfter * 1000, 30_000)
    }
  }
  return Math.min(750 * 2 ** attempt + Math.floor(Math.random() * 250), 15_000)
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
  attempts = 4,
): Promise<Response> {
  let lastResponse: Response | null = null
  let lastError: Error | null = null

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(60_000),
      })
      if (response.ok) return response
      lastResponse = response
      if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts - 1) return response
      await sleep(retryDelayMs(response, attempt))
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt === attempts - 1) break
      await sleep(retryDelayMs(null, attempt))
    }
  }

  if (lastResponse) return lastResponse
  throw new Error(
    `Could not reach ${label} for embeddings after ${attempts} attempts. ` +
      `Check connectivity and provider configuration.` +
      (lastError ? ` (${lastError.name})` : ''),
  )
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await task(items[index] as T, index)
    }
  })
  await Promise.all(workers)
  return results
}

function normalizeVector(vector: number[]): number[] {
  let norm = 0
  for (const value of vector) norm += value * value
  if (norm === 0) return vector
  const scale = 1 / Math.sqrt(norm)
  return vector.map((value) => value * scale)
}

function assertEmbedding(
  value: unknown,
  provider: string,
  options: EmbeddingOptions = {},
): number[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === 'number' && Number.isFinite(item))
  ) {
    throw new Error(`${provider} returned an invalid embedding vector.`)
  }
  if (value.length > EMBEDDING_DIMENSIONS) {
    throw new Error(
      `${provider} returned ${value.length}-dimension embeddings, but this database expects ${EMBEDDING_DIMENSIONS}. ` +
        `Use a model with ${EMBEDDING_DIMENSIONS} dimensions or update the vector column in the RAG migration.`,
    )
  }
  if (value.length < EMBEDDING_DIMENSIONS && !options.allowPadding) {
    throw new Error(
      `${provider} returned ${value.length}-dimension embeddings, but this database expects ${EMBEDDING_DIMENSIONS}. ` +
        `Use a ${EMBEDDING_DIMENSIONS}-dimension embedding model or update the vector column in the RAG migration.`,
    )
  }

  let vector = value
  if (vector.length < EMBEDDING_DIMENSIONS) {
    vector = [...vector, ...new Array<number>(EMBEDDING_DIMENSIONS - vector.length).fill(0)]
  }
  return options.normalize ? normalizeVector(vector) : vector
}

function getHfToken(): string | undefined {
  return readEnv('HF_TOKEN') ?? readEnv('HUGGINGFACE_API_KEY')
}

function getHfModel(): string {
  return readEnv('HF_EMBEDDING_MODEL') ?? HF_DEFAULT_MODEL
}

function getHfUrl(model: string): string {
  return (
    readEnv('HF_EMBEDDINGS_URL') ??
    `https://router.huggingface.co/hf-inference/models/${model}`
  )
}

function parseHfRows(json: unknown): unknown[] {
  if (Array.isArray(json)) {
    if (json.length === 0) return []
    if (typeof json[0] === 'number') return [json]
    if (Array.isArray(json[0])) return json
  }
  if (json && typeof json === 'object') {
    const record = json as Record<string, unknown>
    if (Array.isArray(record.embeddings)) return parseHfRows(record.embeddings)
    if (Array.isArray(record.data)) {
      return record.data.map((row) => {
        if (row && typeof row === 'object' && 'embedding' in row) {
          return (row as { embedding?: unknown }).embedding
        }
        return row
      })
    }
  }
  throw new Error('Hugging Face returned an unexpected embedding response.')
}

async function embedWithHuggingFace(texts: string[]): Promise<number[][]> {
  const token = getHfToken()
  if (!token) {
    throw new Error(
      'HF_TOKEN (or HUGGINGFACE_API_KEY) is required when EMBEDDINGS_PROVIDER=huggingface.',
    )
  }

  const model = getHfModel()
  const url = getHfUrl(model)
  const parsedBatchSize = Number.parseInt(readEnv('HF_EMBEDDING_BATCH_SIZE') ?? '', 10)
  const batchSize =
    Number.isFinite(parsedBatchSize) && parsedBatchSize > 0
      ? Math.min(parsedBatchSize, 64)
      : 32

  const batches: Array<{ start: number; batch: string[] }> = []
  for (let start = 0; start < texts.length; start += batchSize) {
    batches.push({ start, batch: texts.slice(start, start + batchSize) })
  }

  const batchResults = await mapLimit(batches, 2, async ({ batch }) => {
    const response = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: batch,
          options: { wait_for_model: true },
        }),
      },
      'Hugging Face',
    )

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Hugging Face rejected the token (${response.status}). Create a fine-grained token with ` +
            `"Make calls to Inference Providers" permission, or set EMBEDDINGS_PROVIDER=local.` +
            (detail ? ` ${detail.slice(0, 200)}` : ''),
        )
      }
      throw new Error(
        `Hugging Face embeddings failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : '.'}`,
      )
    }

    const rows = parseHfRows(await response.json())
    if (rows.length !== batch.length) {
      throw new Error('Hugging Face returned an unexpected number of embedding vectors.')
    }
    return rows.map((row) =>
      assertEmbedding(row, `Hugging Face (${model})`, {
        allowPadding: true,
        normalize: true,
      }),
    )
  })

  return batchResults.flat()
}

function getGoogleApiKey(): string | undefined {
  return (
    readEnv('GEMINI_API_KEY') ??
    readEnv('GOOGLE_API_KEY') ??
    readEnv('GOOGLE_EMBEDDINGS_API_KEY')
  )
}

function getGoogleEmbedModel(): string {
  return (readEnv('GEMINI_EMBEDDING_MODEL') ?? GOOGLE_DEFAULT_MODEL).replace(/^models\//, '')
}

function getGoogleApiBaseUrl(): string {
  return (readEnv('GEMINI_API_BASE_URL') ?? GOOGLE_DEFAULT_BASE_URL).replace(/\/+$/, '')
}

async function embedWithGoogle(
  texts: string[],
  taskType: 'document' | 'query',
): Promise<number[][]> {
  const apiKey = getGoogleApiKey()
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY (or GOOGLE_API_KEY) is required when EMBEDDINGS_PROVIDER=google.',
    )
  }

  const model = getGoogleEmbedModel()
  const url = `${getGoogleApiBaseUrl()}/models/${encodeURIComponent(model)}:batchEmbedContents`
  const googleTaskType = taskType === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT'
  const parsedBatchSize = Number.parseInt(readEnv('GEMINI_EMBEDDING_BATCH_SIZE') ?? '', 10)
  const batchSize =
    Number.isFinite(parsedBatchSize) && parsedBatchSize > 0
      ? Math.min(parsedBatchSize, 100)
      : 100

  const batches: Array<{ batch: string[] }> = []
  for (let start = 0; start < texts.length; start += batchSize) {
    batches.push({ batch: texts.slice(start, start + batchSize) })
  }

  const batchResults = await mapLimit(batches, 2, async ({ batch }) => {
    const response = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            taskType: googleTaskType,
            outputDimensionality: EMBEDDING_DIMENSIONS,
          })),
        }),
      },
      'the Gemini API',
    )

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Google Gemini rejected the API key (${response.status}). Use a Google AI Studio key ` +
            'with access to the Gemini API, or set EMBEDDINGS_PROVIDER=local.' +
            (detail ? ` ${detail.slice(0, 200)}` : ''),
        )
      }
      if (response.status === 429) {
        throw new Error(
          'Gemini embedding rate limit or quota exceeded. The request was retried with backoff; ' +
            'reduce GEMINI_EMBEDDING_BATCH_SIZE or try again later.',
        )
      }
      throw new Error(
        `Gemini embeddings failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : '.'}`,
      )
    }

    const json = (await response.json()) as {
      embeddings?: Array<{ values?: unknown }>
    }
    const rows = Array.isArray(json.embeddings) ? json.embeddings : []
    if (rows.length !== batch.length) {
      throw new Error('Gemini returned an unexpected number of embedding vectors.')
    }
    return rows.map((row) =>
      assertEmbedding(row.values, `Google Gemini (${model})`, { normalize: true }),
    )
  })

  return batchResults.flat()
}

async function embedWithOllama(texts: string[], config: AppConfig): Promise<number[][]> {
  const baseUrl = getOllamaBaseUrl(config)
  const model = getEmbedModel(config)

  return mapLimit(texts, 2, async (text) => {
    const response = await fetchWithRetry(
      `${baseUrl}/api/embeddings`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
      },
      'Ollama',
    )
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `Ollama embeddings failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : '.'}`,
      )
    }
    const json = (await response.json()) as { embedding?: unknown }
    return assertEmbedding(json.embedding, 'Ollama')
  })
}

async function embedWithOpenAiCompatible(texts: string[]): Promise<number[][]> {
  const apiUrl = readEnv('EMBEDDINGS_API_URL') ?? 'https://api.openai.com/v1/embeddings'
  const apiKey = readEnv('EMBEDDINGS_API_KEY') ?? readEnv('OPENAI_API_KEY')
  if (!apiKey) {
    throw new Error(
      'EMBEDDINGS_API_KEY (or OPENAI_API_KEY) is required when EMBEDDINGS_PROVIDER=openai.',
    )
  }
  const model = readEnv('EMBEDDINGS_MODEL') ?? 'text-embedding-3-small'
  const parsedBatchSize = Number.parseInt(readEnv('EMBEDDINGS_BATCH_SIZE') ?? '', 10)
  const batchSize =
    Number.isFinite(parsedBatchSize) && parsedBatchSize > 0
      ? Math.min(parsedBatchSize, 64)
      : 64

  const batches: Array<{ start: number; batch: string[] }> = []
  for (let start = 0; start < texts.length; start += batchSize) {
    batches.push({ start, batch: texts.slice(start, start + batchSize) })
  }

  const batchResults = await mapLimit(batches, 2, async ({ batch }) => {
    const response = await fetchWithRetry(
      apiUrl,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input: batch,
          dimensions: EMBEDDING_DIMENSIONS,
          encoding_format: 'float',
        }),
      },
      'the embedding API',
    )
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      if (response.status === 401 || response.status === 403) {
        throw new Error(`The embedding API rejected the API key (${response.status}).`)
      }
      throw new Error(
        `Embedding API failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : '.'}`,
      )
    }

    const json = (await response.json()) as {
      data?: Array<{ index?: number; embedding?: unknown }>
    }
    const rows = Array.isArray(json.data)
      ? [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      : []
    if (rows.length !== batch.length) {
      throw new Error('The embedding API returned an unexpected number of vectors.')
    }
    return rows.map((row) => assertEmbedding(row.embedding, 'The embedding API'))
  })

  return batchResults.flat()
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function addFeature(vector: Float64Array, feature: string, weight: number): void {
  const hash = fnv1a(feature)
  const index = hash % EMBEDDING_DIMENSIONS
  const sign = (hash & 0x80000000) === 0 ? 1 : -1
  vector[index] += sign * weight
}

function localEmbedding(text: string): number[] {
  const vector = new Float64Array(EMBEDDING_DIMENSIONS)
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const counts = new Map<string, number>()

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }

  for (const [token, count] of counts) {
    const weight = 1 + Math.log(count)
    addFeature(vector, `w:${token}`, weight)
    const padded = `^${token}$`
    for (let i = 0; i < padded.length - 2; i++) {
      addFeature(vector, `c:${padded.slice(i, i + 3)}`, weight * 0.35)
    }
  }

  let norm = 0
  for (const value of vector) norm += value * value
  if (norm === 0) {
    vector[0] = 1
    norm = 1
  }
  const scale = 1 / Math.sqrt(norm)
  return Array.from(vector, (value) => value * scale)
}

export async function embedText(
  texts: string[],
  config: AppConfig,
  options: EmbedTextOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) return []
  const provider = getEmbeddingProvider()

  if (provider === 'ollama') return embedWithOllama(texts, config)
  if (provider === 'openai') return embedWithOpenAiCompatible(texts)
  if (provider === 'huggingface') return embedWithHuggingFace(texts)
  if (provider === 'google') return embedWithGoogle(texts, options.taskType ?? 'document')
  return texts.map((text) => localEmbedding(text))
}
