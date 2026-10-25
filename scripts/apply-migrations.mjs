#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const projectUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''

if (!projectUrl) {
  console.error('Missing SUPABASE_URL or VITE_SUPABASE_URL in the environment.')
  process.exit(1)
}
if (!accessToken) {
  console.error('Missing SUPABASE_ACCESS_TOKEN.')
  console.error('Create a personal access token at:')
  console.error('  https://supabase.com/dashboard/account/tokens')
  console.error('Then add this line to .env (never commit the real token):')
  console.error('  SUPABASE_ACCESS_TOKEN=sbp_your_token')
  process.exit(1)
}

let projectRef = ''
try {
  projectRef = new URL(projectUrl).hostname.split('.')[0]
} catch {
  console.error(`Invalid Supabase project URL: ${projectUrl}`)
  process.exit(1)
}
if (!projectRef) {
  console.error('Could not determine the Supabase project ref from SUPABASE_URL.')
  process.exit(1)
}

const managementUrl = `https://api.supabase.com/v1/projects/${projectRef}`
const migrations = [
  'migrations/001_auth_chat_history.sql',
  'migrations/002_rag_pgvector.sql',
  'migrations/003_auth_hardening.sql',
  'migrations/004_history_pagination_and_scoped_rag.sql',
  'migrations/005_rag_ready_documents.sql',
  'migrations/006_persistent_document_attachments.sql',
]

async function runSql(query, label) {
  const response = await fetch(`${managementUrl}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const text = await response.text()
  if (!response.ok) {
    let detail = text
    try {
      const json = JSON.parse(text)
      detail = json.message ?? json.error ?? text
    } catch {
      // Keep the raw response.
    }
    throw new Error(`${label} failed: HTTP ${response.status} ${detail}`)
  }
  return text
}

async function enableAnonymousSignIns() {
  const response = await fetch(`${managementUrl}/config/auth`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ external_anonymous_users_enabled: true }),
  })
  const text = await response.text()
  if (!response.ok) {
    let detail = text
    try {
      const json = JSON.parse(text)
      detail = json.message ?? json.error ?? text
    } catch {
      // Keep the raw response.
    }
    throw new Error(
      `Enabling anonymous sign-ins failed: HTTP ${response.status} ${detail}. ` +
        'Enable it in Supabase Dashboard → Authentication → Sign In / Providers → Anonymous.',
    )
  }
  console.log('[ok] Anonymous sign-ins enabled')
}

console.log(`Applying ${migrations.length} migrations to project ${projectRef}...`)

for (const migration of migrations) {
  const sql = await readFile(join(root, migration), 'utf8')
  try {
    await runSql(sql, migration)
    console.log(`[ok] ${migration}`)
  } catch (error) {
    console.error(`[error] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

try {
  await enableAnonymousSignIns()
} catch (error) {
  console.error(`[error] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

console.log('\nAll migrations applied and anonymous sign-ins enabled. Run npm run verify:supabase to confirm.')
