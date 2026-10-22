import type { AppConfig } from '../config.ts'

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function getOllamaBaseUrl(config: AppConfig): string {
  return readEnv('OLLAMA_BASE_URL') ?? 'http://localhost:11434'
}

export function getEmbedModel(config: AppConfig): string {
  return readEnv('OLLAMA_EMBED_MODEL') ?? readEnv('GROQ_EMBED_MODEL') ?? 'nomic-embed-text'
}

export async function embedText(texts: string[], config: AppConfig): Promise<number[][]> {
  const baseUrl = getOllamaBaseUrl(config)
  const model = getEmbedModel(config)
  const results: number[][] = []
  for (const t of texts) {
    const res = await fetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: t }),
    })
    if (!res.ok) {
      const msg = await res.text().catch(() => '')
      throw new Error(`Ollama embeddings failed: ${res.status} ${msg}`)
    }
    const json = (await res.json()) as { embedding?: number[] }
    if (!Array.isArray(json.embedding)) throw new Error('Invalid embedding response')
    results.push(json.embedding)
  }
  return results
}
