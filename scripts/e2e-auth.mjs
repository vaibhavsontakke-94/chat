const supabaseUrl = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''
const apiBase = (process.env.E2E_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '')
const email = process.env.E2E_EMAIL ?? ''
const password = process.env.E2E_PASSWORD ?? ''
const otherEmail = process.env.E2E_OTHER_EMAIL ?? ''
const otherPassword = process.env.E2E_OTHER_PASSWORD ?? ''

if (!supabaseUrl || !anonKey) {
  console.error('Missing Supabase URL or anon key in the environment.')
  process.exit(1)
}
if (!email || !password) {
  console.error('Missing E2E_EMAIL / E2E_PASSWORD.')
  console.error('Create a confirmed test user in Supabase Authentication -> Users, then run:')
  console.error('  $env:E2E_EMAIL="test-user@example.com"; $env:E2E_PASSWORD="..."')
  console.error('  npm run e2e:auth')
  process.exit(1)
}

function fail(message) {
  throw new Error(message)
}

async function request(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // Keep the raw text for diagnostics.
  }
  return { response, json, text }
}

async function signIn(address, secret) {
  const result = await request(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: address, password: secret }),
  })
  if (!result.response.ok || !result.json?.access_token) {
    const code = result.json?.error_code ?? result.json?.error ?? `HTTP ${result.response.status}`
    fail(`Supabase sign-in failed: ${code}`)
  }
  return result.json
}

async function api(token, path, options = {}) {
  const headers = new Headers(options.headers ?? {})
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return request(`${apiBase}${path}`, { ...options, headers })
}

async function expectStatus(result, status, label) {
  if (result.response.status !== status) {
    const detail = result.json?.error ?? result.json?.message ?? result.text.slice(0, 200)
    fail(`${label}: expected HTTP ${status}, got ${result.response.status}${detail ? ` (${detail})` : ''}`)
  }
}

const steps = []
function ok(label) {
  steps.push(label)
  console.log(`[ok] ${label}`)
}

const health = await request(`${apiBase}/api/health`)
if (!health.response.ok) fail(`API is not reachable at ${apiBase}. Start it with npm start.`)
ok('API health')

const anonymousConversations = await api(null, '/api/conversations')
await expectStatus(anonymousConversations, 401, 'unauthenticated conversations')
const anonymousDocuments = await api(null, '/api/documents')
await expectStatus(anonymousDocuments, 401, 'unauthenticated documents')
ok('unauthenticated APIs return 401')

const session = await signIn(email, password)
const token = session.access_token
ok(`password sign-in (${session.user?.id ? 'user session received' : 'session received'})`)

const documents = await api(token, '/api/documents')
await expectStatus(documents, 200, 'load documents')
ok(`load own documents (${documents.json?.documents?.length ?? 0})`)

const before = await api(token, '/api/conversations')
await expectStatus(before, 200, 'load conversations')

const title = `E2E auth check ${Date.now()}`
const created = await api(token, '/api/conversations', {
  method: 'POST',
  body: JSON.stringify({ title }),
})
await expectStatus(created, 201, 'create conversation')
const conversationId = created.json?.conversation?.id
if (typeof conversationId !== 'string') fail('Create conversation did not return an id.')
ok('create conversation')

try {
  const userMessage = await api(token, `/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role: 'user', content: 'E2E user message' }),
  })
  await expectStatus(userMessage, 201, 'save user message')

  const assistantMessage = await api(token, `/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role: 'assistant', content: 'E2E assistant message', model: 'e2e-test' }),
  })
  await expectStatus(assistantMessage, 201, 'save assistant message')

  const messages = await api(token, `/api/conversations/${conversationId}`)
  await expectStatus(messages, 200, 'load messages')
  const loaded = messages.json?.messages ?? []
  if (loaded.length !== 2) fail(`Expected 2 saved messages, got ${loaded.length}.`)
  if (loaded[0]?.content !== 'E2E user message' || loaded[1]?.content !== 'E2E assistant message') {
    fail('Saved messages did not round-trip correctly.')
  }
  ok('persist and reload messages')

  const renamed = await api(token, `/api/conversations/${conversationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: `${title} renamed` }),
  })
  await expectStatus(renamed, 200, 'rename conversation')
  ok('rename conversation')

  if (otherEmail && otherPassword) {
    const otherSession = await signIn(otherEmail, otherPassword)
    const crossRead = await api(otherSession.access_token, `/api/conversations/${conversationId}`)
    await expectStatus(crossRead, 404, 'cross-user conversation read')

    const otherDocuments = await api(otherSession.access_token, '/api/documents')
    await expectStatus(otherDocuments, 200, 'load second user documents')
    const firstIds = new Set((documents.json?.documents ?? []).map((doc) => doc.id))
    const leaked = (otherDocuments.json?.documents ?? []).filter((doc) => firstIds.has(doc.id))
    if (leaked.length > 0) fail('Second user can see the first user\'s documents.')
    ok('cross-user isolation (conversation + documents)')
  }
} finally {
  const removed = await api(token, `/api/conversations/${conversationId}`, { method: 'DELETE' })
  await expectStatus(removed, 200, 'delete conversation')
  const afterDelete = await api(token, `/api/conversations/${conversationId}`)
  await expectStatus(afterDelete, 404, 'deleted conversation lookup')
}

const after = await api(token, '/api/conversations')
await expectStatus(after, 200, 'reload conversations')
const stillPresent = (after.json?.conversations ?? []).some((item) => item.id === conversationId)
if (stillPresent) fail('Deleted conversation is still in the list.')
ok('delete conversation and verify removal')

console.log(`\nPassed ${steps.length} end-to-end checks using a real Supabase user.`)
