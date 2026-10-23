const rawUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''
const baseUrl = rawUrl.replace(/\/+$/, '')

if (!baseUrl || !anonKey) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY.')
  process.exit(1)
}

const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
const failures = []

function report(kind, label, detail) {
  console.log(`[${kind}] ${label}${detail ? ` - ${detail}` : ''}`)
  if (kind === 'missing' || kind === 'error') failures.push(label)
}

async function request(url, options = {}) {
  try {
    const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } })
    const text = await response.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      // Non-JSON response.
    }
    return { response, json, text }
  } catch (error) {
    return { error }
  }
}

const settings = await request(`${baseUrl}/auth/v1/settings`)
if (settings.error) {
  report('error', 'Supabase Auth', 'unreachable')
} else if (!settings.response.ok) {
  report('error', 'Supabase Auth', `HTTP ${settings.response.status}`)
} else {
  report('ok', 'Supabase Auth', 'reachable')
  const anonymousEnabled = Boolean(settings.json?.external?.anonymous_users)
  report(
    anonymousEnabled ? 'ok' : 'missing',
    'Anonymous sign-ins',
    anonymousEnabled ? 'enabled' : 'disabled',
  )
  const emailEnabled = Boolean(settings.json?.external?.email)
  report(emailEnabled ? 'ok' : 'missing', 'Email provider', emailEnabled ? 'enabled' : 'disabled')
  if (settings.json?.mailer_autoconfirm === false) {
    report('warn', 'Email confirmation', 'required (signup returns no session until confirmed)')
  } else {
    report('ok', 'Email confirmation', 'disabled (signup signs in immediately)')
  }
  report(
    settings.json?.external?.google ? 'ok' : 'warn',
    'Google provider',
    settings.json?.external?.google ? 'enabled' : 'disabled',
  )
}

for (const table of ['conversations', 'messages', 'documents', 'document_chunks']) {
  const result = await request(`${baseUrl}/rest/v1/${table}?select=*&limit=1`)
  if (result.error) {
    report('error', `Table public.${table}`, 'unreachable')
  } else if (result.response.status === 404) {
    report('missing', `Table public.${table}`, result.json?.message ?? 'not found')
  } else if (result.response.status === 401 || result.response.status === 403) {
    report('ok', `Table public.${table}`, 'exists (RLS blocks anonymous access)')
  } else if (result.response.ok) {
    report('ok', `Table public.${table}`, 'exists')
  } else {
    report('error', `Table public.${table}`, `HTTP ${result.response.status}`)
  }
}

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (serviceKey) {
  const bucket = await request(`${baseUrl}/storage/v1/bucket/documents`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  })
  if (bucket.error) {
    report('error', 'Storage bucket documents', 'unreachable')
  } else if (bucket.response.status === 404 || bucket.response.status === 400) {
    report('missing', 'Storage bucket documents', 'not found')
  } else if (bucket.response.ok) {
    report(
      'ok',
      'Storage bucket documents',
      bucket.json?.public ? 'exists (public, should be private)' : 'exists (private)',
    )
  } else {
    report('error', 'Storage bucket documents', `HTTP ${bucket.response.status}`)
  }
} else {
  report('warn', 'Storage bucket documents', 'set SUPABASE_SERVICE_ROLE_KEY to verify')
}

const login = await request(`${baseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: `nyra-auth-check-${Date.now()}@invalid.example`,
    password: 'not-the-right-password',
  }),
})
if (login.error) {
  report('error', 'Password sign-in endpoint', 'unreachable')
} else if (login.response.status === 400) {
  report('ok', 'Password sign-in endpoint', 'rejects invalid credentials')
} else {
  report('error', 'Password sign-in endpoint', `unexpected HTTP ${login.response.status}`)
}

const functions = [
  {
    name: 'match_document_chunks',
    body: { query_embedding: null, match_count: 1 },
  },
  {
    name: 'match_document_chunks_for_user',
    body: { query_embedding: null, p_user_id: null, match_count: 1 },
  },
]

for (const fn of functions) {
  const result = await request(`${baseUrl}/rest/v1/rpc/${fn.name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fn.body),
  })
  if (result.error) {
    report('error', `RAG function ${fn.name}`, 'unreachable')
  } else if (result.response.status === 404) {
    report('missing', `RAG function ${fn.name}`, result.json?.message ?? 'not found')
  } else {
    report('ok', `RAG function ${fn.name}`, 'exists (anonymous access denied as expected)')
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} required item(s) need attention.`)
  process.exit(1)
}

console.log('\nSupabase setup looks complete.')
