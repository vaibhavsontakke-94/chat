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

export function loadConfig(): AppConfig {
  return {
    port: toNumber(readEnv('PORT'), 3001),
    groqApiKey: readEnv('GROQ_API_KEY') ?? null,
    groqChatModel: readEnv('GROQ_CHAT_MODEL') ?? 'openai/gpt-oss-20b',
    groqBaseUrl: readEnv('GROQ_BASE_URL') ?? 'https://api.groq.com/openai/v1',
    allowedOrigins: readAllowedOrigins(),
    modelCacheTtlMs: toNumber(readEnv('MODEL_CACHE_TTL_MS'), 5 * 60_000),
    supabaseUrl: readEnv('SUPABASE_URL') ?? null,
    supabaseAnonKey: readEnv('VITE_SUPABASE_ANON_KEY') ?? readEnv('SUPABASE_ANON_KEY') ?? null,
    supabaseServiceRoleKey: readEnv('SUPABASE_SERVICE_ROLE_KEY') ?? null,
    supabaseJwtSecret: readEnv('SUPABASE_JWT_SECRET') ?? null,
  }
}

export function isGroqConfigured(config: AppConfig): boolean {
  return config.groqApiKey !== null
}
