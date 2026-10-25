import test from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import type { IncomingMessage } from 'node:http'
import type { AppConfig } from '../config.ts'
import { getAuthUser, getBearerToken } from '../middleware/auth.ts'

const TEST_SECRET = 'test-only-supabase-jwt-secret-at-least-32-chars'

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 3001,
    groqApiKey: null,
    groqChatModel: 'test-model',
    groqBaseUrl: 'https://example.com',
    allowedOrigins: [],
    modelCacheTtlMs: 1000,
    supabaseUrl: null,
    supabaseAnonKey: null,
    supabaseServiceRoleKey: null,
    supabaseJwtSecret: TEST_SECRET,
    cronSecret: null,
    ragSimilarityThreshold: 0.2,
    ragRelativeThreshold: 0.55,
    ragMaxContextChunks: 6,
    ragCandidateCount: 30,
    ragQuestionBatchSize: 5,
    ragAnswerAllMaxQuestions: 25,
    ...overrides,
  }
}

function makeRequest(authorization?: string): IncomingMessage {
  return {
    headers: authorization === undefined ? {} : { authorization },
  } as IncomingMessage
}

function signToken(
  payload: Record<string, unknown>,
  secret = TEST_SECRET,
  options: jwt.SignOptions = {},
): string {
  return jwt.sign(payload, secret, { expiresIn: '5m', ...options })
}

test('getBearerToken extracts only bearer credentials', () => {
  assert.equal(getBearerToken(makeRequest('Bearer abc.def.ghi')), 'abc.def.ghi')
  assert.equal(getBearerToken(makeRequest('Bearer   token  ')), 'token')
  assert.equal(getBearerToken(makeRequest('Basic abc')), null)
  assert.equal(getBearerToken(makeRequest('Bearer ')), null)
  assert.equal(getBearerToken(makeRequest()), null)
})

test('getAuthUser accepts an authenticated Supabase user token', async () => {
  const token = signToken({
    sub: '4f4f0b3d-01a8-4b52-b45d-1d0d0de0f111',
    email: 'user@example.com',
    role: 'authenticated',
    aud: 'authenticated',
  })

  const user = await getAuthUser(makeRequest(`Bearer ${token}`), makeConfig())
  assert.deepEqual(user, {
    id: '4f4f0b3d-01a8-4b52-b45d-1d0d0de0f111',
    email: 'user@example.com',
  })
})

test('getAuthUser accepts an anonymous Supabase user token', async () => {
  const token = signToken({
    sub: '8a3c0f6e-1d8c-4d0a-9c0e-2b7e5a4d6f22',
    role: 'authenticated',
    aud: 'authenticated',
    is_anonymous: true,
  })

  const user = await getAuthUser(makeRequest(`Bearer ${token}`), makeConfig())
  assert.deepEqual(user, {
    id: '8a3c0f6e-1d8c-4d0a-9c0e-2b7e5a4d6f22',
    email: undefined,
  })
})

test('getAuthUser rejects anon-key and service-role tokens', async () => {
  const anonymous = signToken({ role: 'anon', aud: 'authenticated' })
  const service = signToken({
    sub: 'service-account',
    role: 'service_role',
    aud: 'authenticated',
  })

  assert.equal(await getAuthUser(makeRequest(`Bearer ${anonymous}`), makeConfig()), null)
  assert.equal(await getAuthUser(makeRequest(`Bearer ${service}`), makeConfig()), null)
})

test('getAuthUser rejects tokens without a user subject', async () => {
  const token = signToken({ role: 'authenticated', aud: 'authenticated' })
  assert.equal(await getAuthUser(makeRequest(`Bearer ${token}`), makeConfig()), null)
})

test('getAuthUser rejects a mismatched audience', async () => {
  const token = signToken({
    sub: 'user-id',
    role: 'authenticated',
    aud: 'anon',
  })
  assert.equal(await getAuthUser(makeRequest(`Bearer ${token}`), makeConfig()), null)
})

test('getAuthUser rejects expired and incorrectly signed tokens', async () => {
  const expired = signToken(
    { sub: 'user-id', role: 'authenticated', aud: 'authenticated' },
    TEST_SECRET,
    { expiresIn: -10 },
  )
  const wrongSecret = signToken(
    { sub: 'user-id', role: 'authenticated', aud: 'authenticated' },
    'a-different-secret-that-is-long-enough',
  )

  assert.equal(await getAuthUser(makeRequest(`Bearer ${expired}`), makeConfig()), null)
  assert.equal(await getAuthUser(makeRequest(`Bearer ${wrongSecret}`), makeConfig()), null)
})

test('getAuthUser returns null when no verification method is configured', async () => {
  const token = signToken({ sub: 'user-id', role: 'authenticated', aud: 'authenticated' })
  const config = makeConfig({ supabaseJwtSecret: null })
  assert.equal(await getAuthUser(makeRequest(`Bearer ${token}`), config), null)
})
