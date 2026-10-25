export interface AppConfig {
  port: number
  groqApiKey: string | null
  groqChatModel: string
  groqBaseUrl: string
  allowedOrigins: string[]
  modelCacheTtlMs: number
  supabaseUrl: string | null
  supabaseAnonKey: string | null
  supabaseServiceRoleKey: string | null
  supabaseJwtSecret: string | null
  cronSecret: string | null
  ragSimilarityThreshold: number
  ragRelativeThreshold: number
  ragMaxContextChunks: number
  ragCandidateCount: number
  ragQuestionBatchSize: number
  ragAnswerAllMaxQuestions: number
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function toNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function toFloat(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function readAllowedOrigins(): string[] {
  const configured = readEnv('APP_ORIGINS')
  const defaults = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
  ]
  if (!configured) return defaults
  return [...new Set([...defaults, ...configured.split(',').map((o) => o.trim()).filter(Boolean)])]
}

function toBoundedFloat(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = toFloat(value, fallback)
  return Math.min(Math.max(parsed, min), max)
}

export function loadConfig(): AppConfig {
  const groqApiKey = readEnv('GROQ_API_KEY')
  const xaiApiKey = readEnv('XAI_API_KEY') ?? readEnv('GROK_API_KEY')
  const useXai = groqApiKey === undefined && xaiApiKey !== undefined

  return {
    port: toNumber(readEnv('PORT'), 3001),
    groqApiKey: groqApiKey ?? xaiApiKey ?? null,
    groqChatModel:
      readEnv('GROQ_CHAT_MODEL') ??
      readEnv('GROK_CHAT_MODEL') ??
      (useXai ? 'grok-3-mini' : 'openai/gpt-oss-20b'),
    groqBaseUrl:
      readEnv('GROQ_BASE_URL') ??
      readEnv('XAI_BASE_URL') ??
      (useXai ? 'https://api.x.ai/v1' : 'https://api.groq.com/openai/v1'),
    allowedOrigins: readAllowedOrigins(),
    modelCacheTtlMs: toNumber(readEnv('MODEL_CACHE_TTL_MS'), 5 * 60_000),
    supabaseUrl: readEnv('SUPABASE_URL') ?? null,
    supabaseAnonKey: readEnv('VITE_SUPABASE_ANON_KEY') ?? readEnv('SUPABASE_ANON_KEY') ?? null,
    supabaseServiceRoleKey: readEnv('SUPABASE_SERVICE_ROLE_KEY') ?? null,
    supabaseJwtSecret: readEnv('SUPABASE_JWT_SECRET') ?? null,
    cronSecret: readEnv('CRON_SECRET') ?? null,
    ragSimilarityThreshold: toBoundedFloat(readEnv('RAG_SIMILARITY_THRESHOLD'), 0.2, 0, 1),
    ragRelativeThreshold: toBoundedFloat(readEnv('RAG_RELATIVE_THRESHOLD'), 0.55, 0, 1),
    ragMaxContextChunks: toNumber(readEnv('RAG_MAX_CONTEXT_CHUNKS'), 8),
    ragCandidateCount: toNumber(readEnv('RAG_CANDIDATE_COUNT'), 30),
    ragQuestionBatchSize: toNumber(readEnv('RAG_QUESTION_BATCH_SIZE'), 5),
    ragAnswerAllMaxQuestions: toNumber(readEnv('RAG_ANSWER_ALL_MAX_QUESTIONS'), 25),
  }
}

export function isGroqConfigured(config: AppConfig): boolean {
  return config.groqApiKey !== null
}
