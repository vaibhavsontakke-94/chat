import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const apiBase = (process.env.E2E_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '')

function makePdf(lines) {
  let stream = 'BT /F1 12 Tf 72 720 Td '
  lines.forEach((line, index) => {
    const escaped = line.replace(/[()\\]/g, (c) => `\\${c}`)
    stream += `${index === 0 ? '' : '0 -18 Td '}(${escaped}) Tj `
  })
  stream += 'ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let output = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(output, 'latin1')
    output += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(output, 'latin1')
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= objects.length; index++) {
    output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(output, 'latin1')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

async function waitForDocument(token, documentId, wantedStatus) {
  const deadline = Date.now() + 120_000
  let last = null
  while (Date.now() < deadline) {
    const res = await fetch(`${apiBase}/api/documents`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`document list failed: ${res.status}`)
    const json = await res.json()
    const document = (json.documents ?? []).find((item) => item.id === documentId)
    last = document
    if (document?.status === wantedStatus) return document
    if (document?.status === 'failed') {
      throw new Error(`document failed: ${document.error_message ?? 'unknown error'}`)
    }
    await sleep(1000)
  }
  throw new Error(`timed out waiting for ${wantedStatus}: ${JSON.stringify(last)}`)
}

const supabase = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { data: auth, error: authError } = await supabase.auth.signInAnonymously()
if (authError) throw authError
const token = auth.session.access_token
console.log('[ok] anonymous session', auth.user.id)

let conversationId = null
let documentId = null

try {
  const conversationRes = await fetch(`${apiBase}/api/conversations`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ title: 'RAG verification' }),
  })
  const conversation = await conversationRes.json()
  if (!conversationRes.ok || !conversation.conversation?.id) {
    throw new Error(`conversation failed: ${JSON.stringify(conversation)}`)
  }
  conversationId = conversation.conversation.id
  console.log('[ok] conversation', conversationId)

  const pdf = makePdf([
    'Nyra RAG end to end verification document.',
    'The project code name is ORBITAL-42.',
    'The launch window opens on the third Tuesday of November.',
  ])
  const form = new FormData()
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'rag-e2e.pdf')
  form.append('conversationId', conversationId)
  const uploadRes = await fetch(`${apiBase}/api/documents/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const upload = await uploadRes.json()
  if (!uploadRes.ok) throw new Error(`upload failed: ${JSON.stringify(upload)}`)
  if (!upload.documentId) throw new Error(`upload returned no document: ${JSON.stringify(upload)}`)
  documentId = upload.documentId
  console.log('[ok] uploaded', documentId, 'status:', upload.status)

  const completed = await waitForDocument(token, documentId, 'completed')
  if (!completed.conversation_ids?.includes(conversationId)) {
    throw new Error('document was not attached to the conversation')
  }
  console.log('[ok] processed + attached', 'pages:', completed.page_count)

  const reindexRes = await fetch(`${apiBase}/api/documents/${documentId}/reindex`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const reindex = await reindexRes.json()
  if (!reindexRes.ok) throw new Error(`reindex failed: ${JSON.stringify(reindex)}`)
  await waitForDocument(token, documentId, 'completed')
  console.log('[ok] reindexed', documentId)

  const debugRes = await fetch(`${apiBase}/api/documents/${documentId}/debug`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ query: 'about', conversationId }),
  })
  const debug = await debugRes.json()
  if (!debugRes.ok) throw new Error(`debug failed: ${JSON.stringify(debug)}`)
  console.log('[ok] debug chunks:', debug.chunk_count, 'dimensions:', debug.embedding_dimensions)
  if (!debug.chunk_count) throw new Error('debug reported no chunks')
  if (debug.embedding_dimensions !== 768) {
    throw new Error(`unexpected embedding dimensions: ${debug.embedding_dimensions}`)
  }
  if (!debug.would_reach_llm) throw new Error('debug reported context would not reach the LLM')
  if (debug.retrieval_error) throw new Error(`debug retrieval error: ${debug.retrieval_error}`)
  if (!debug.citations) throw new Error('debug reported no citations')
  console.log('[ok] debug retrieval reaches prompt with context')

  const chatRes = await fetch(`${apiBase}/api/chat`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'What is the project code name?' }],
      rag: true,
      conversationId,
    }),
  })
  if (!chatRes.ok) throw new Error(`chat failed: ${chatRes.status} ${await chatRes.text()}`)

  const raw = await chatRes.text()
  const events = raw
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1]
      const data = /^data: (.+)$/m.exec(block)?.[1]
      return { event, data: data ? JSON.parse(data) : null }
    })
  const citations = events.find((event) => event.event === 'citations')?.data
  const answer = events
    .filter((event) => event.event === 'delta')
    .map((event) => event.data?.text ?? '')
    .join('')
  const done = events.find((event) => event.event === 'done')?.data
  const failure = events.find((event) => event.event === 'error')?.data

  console.log('[info] mode:', citations?.mode, 'citations:', citations?.citations?.length ?? 0)
  console.log('[info] answer:', answer.trim())
  if (failure) throw new Error(`chat stream error: ${JSON.stringify(failure)}`)
  if (!citations?.found) throw new Error('RAG returned no citations')
  if (citations.mode !== 'document') throw new Error(`unexpected mode: ${citations.mode}`)
  if (!done) throw new Error('RAG stream did not complete')
  if (!/ORBITAL-42/i.test(answer)) throw new Error('Answer did not use the retrieved document content')
  console.log('[ok] RAG retrieval + grounded answer')

  const vagueRes = await fetch(`${apiBase}/api/chat`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'about' }],
      rag: true,
      conversationId,
    }),
  })
  if (!vagueRes.ok) throw new Error(`vague chat failed: ${vagueRes.status}`)
  const vagueRaw = await vagueRes.text()
  const vagueEvents = vagueRaw
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1]
      const data = /^data: (.+)$/m.exec(block)?.[1]
      return { event, data: data ? JSON.parse(data) : null }
    })
  const vagueCitations = vagueEvents.find((event) => event.event === 'citations')?.data
  const vagueAnswer = vagueEvents
    .filter((event) => event.event === 'delta')
    .map((event) => event.data?.text ?? '')
    .join('')
    .trim()
  console.log('[info] vague mode:', vagueCitations?.mode, 'answer:', vagueAnswer)
  if (vagueCitations?.mode !== 'document') {
    throw new Error(`vague document question used mode ${vagueCitations?.mode}`)
  }
  if (!vagueCitations?.found) throw new Error('vague document question returned no citations')
  if (/could not find this information in the provided documents/i.test(vagueAnswer)) {
    throw new Error('vague document question incorrectly used the no-information fallback')
  }
  console.log('[ok] vague overview question used retrieved context')

  const generalRes = await fetch(`${apiBase}/api/chat`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Say hello in exactly three words.' }],
      rag: true,
      conversationId,
    }),
  })
  if (!generalRes.ok) throw new Error(`general chat failed: ${generalRes.status}`)
  const generalRaw = await generalRes.text()
  const generalEvents = generalRaw
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1]
      const data = /^data: (.+)$/m.exec(block)?.[1]
      return { event, data: data ? JSON.parse(data) : null }
    })
  const generalCitations = generalEvents.find((event) => event.event === 'citations')?.data
  if (generalCitations?.mode !== 'general') {
    throw new Error(`general question used mode ${generalCitations?.mode}`)
  }
  console.log('[ok] general question bypassed document grounding')
} finally {
  if (documentId) {
    const deleted = await fetch(`${apiBase}/api/documents/${documentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    console.log(deleted.ok ? '[ok] document cleanup' : `[warn] document cleanup failed ${deleted.status}`)
  }
  if (conversationId) {
    const deleted = await fetch(`${apiBase}/api/conversations/${conversationId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    console.log(deleted.ok ? '[ok] conversation cleanup' : `[warn] conversation cleanup failed ${deleted.status}`)
  }
  await supabase.auth.signOut()
}
