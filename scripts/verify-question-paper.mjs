import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const apiBase = (process.env.E2E_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '')

function makePdf(lines) {
  let stream = 'BT /F1 12 Tf 72 720 Td '
  lines.forEach((line, index) => {
    const escaped = line.replace(/[()\\]/g, (c) => `\\${c}`)
    stream += `${index === 0 ? '' : '0 -20 Td '}(${escaped}) Tj `
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
  const deadline = Date.now() + 180_000
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
      throw new Error(
        `document failed during ${document.last_error_stage ?? 'unknown'}: ${document.error_message ?? 'unknown error'}`,
      )
    }
    await sleep(1000)
  }
  throw new Error(`timed out waiting for ${wantedStatus}: ${JSON.stringify(last)}`)
}

async function upload(token, conversationId, name, buffer, type) {
  const form = new FormData()
  form.append('file', new Blob([buffer], { type }), name)
  form.append('conversationId', conversationId)
  const res = await fetch(`${apiBase}/api/documents/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`upload failed: ${JSON.stringify(json)}`)
  return json
}

function parseEvents(raw) {
  return raw
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1]
      const data = /^data: (.+)$/m.exec(block)?.[1]
      return { event, data: data ? JSON.parse(data) : null }
    })
}

async function ask(token, conversationId, content) {
  const res = await fetch(`${apiBase}/api/chat`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      messages: [{ role: 'user', content }],
      rag: true,
      conversationId,
    }),
  })
  if (!res.ok) throw new Error(`chat failed: ${res.status} ${await res.text()}`)
  const events = parseEvents(await res.text())
  const answer = events
    .filter((event) => event.event === 'delta')
    .map((event) => event.data?.text ?? '')
    .join('')
  const citations = events.find((event) => event.event === 'citations')?.data
  const error = events.find((event) => event.event === 'error')?.data
  return { answer, citations, error }
}

const supabase = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { data: auth, error: authError } = await supabase.auth.signInAnonymously()
if (authError) throw authError
const token = auth.session.access_token
console.log('[ok] anonymous session', auth.user.id)

let conversationId = null
const documentIds = []

try {
  const conversationRes = await fetch(`${apiBase}/api/conversations`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ title: 'Question paper verification' }),
  })
  const conversation = await conversationRes.json()
  if (!conversationRes.ok || !conversation.conversation?.id) {
    throw new Error(`conversation failed: ${JSON.stringify(conversation)}`)
  }
  conversationId = conversation.conversation.id
  console.log('[ok] conversation', conversationId)

  const paper = makePdf([
    'Section A',
    '1. What is the capital of France? (2 marks)',
    'a) Paris',
    'b) London',
    '2. Explain photosynthesis. (5 marks)',
    '3. What is 2 + 2? (1 mark)',
  ])
  const notes = makePdf([
    'Study notes for the practice paper.',
    'Paris is the capital of France.',
    'Photosynthesis converts light energy into chemical energy and releases oxygen.',
    'Two plus two equals four.',
  ])

  const paperUpload = await upload(token, conversationId, 'practice-paper.pdf', paper, 'application/pdf')
  const notesUpload = await upload(token, conversationId, 'study-notes.pdf', notes, 'application/pdf')
  documentIds.push(paperUpload.documentId, notesUpload.documentId)
  console.log('[ok] uploaded paper', paperUpload.documentId, 'and notes', notesUpload.documentId)

  const paperDoc = await waitForDocument(token, paperUpload.documentId, 'completed')
  await waitForDocument(token, notesUpload.documentId, 'completed')
  console.log('[ok] documents completed; paper chunks:', paperDoc.chunk_count)

  const { data: questions, error: questionError } = await supabase
    .from('document_questions')
    .select('question_number, question_key, question_text, options, marks')
    .eq('document_id', paperUpload.documentId)
    .order('order_index', { ascending: true })
  if (questionError) throw questionError
  console.log(
    '[info] parsed questions:',
    (questions ?? []).map((question) => question.question_number).join(', '),
  )
  if ((questions ?? []).length !== 3) {
    throw new Error(`expected 3 parsed questions, got ${questions?.length ?? 0}`)
  }
  const first = questions[0]
  if (!Array.isArray(first.options) || first.options.length !== 2) {
    throw new Error(`question 1 options were not stored: ${JSON.stringify(first.options)}`)
  }
  if (first.marks !== '2') throw new Error(`question 1 marks were not stored: ${first.marks}`)

  const duplicate = await upload(token, conversationId, 'practice-paper.pdf', paper, 'application/pdf')
  if (duplicate.duplicate !== true || duplicate.documentId !== paperUpload.documentId) {
    throw new Error(`content-hash duplicate detection failed: ${JSON.stringify(duplicate)}`)
  }
  console.log('[ok] content-hash duplicate detection')

  const single = await ask(token, conversationId, 'answer question 1')
  if (single.error) throw new Error(`single-question chat error: ${JSON.stringify(single.error)}`)
  if (single.citations?.mode !== 'document') {
    throw new Error(`single question used mode ${single.citations?.mode}`)
  }
  if (!/paris/i.test(single.answer)) {
    throw new Error(`single-question answer did not use the notes: ${single.answer.slice(0, 300)}`)
  }
  console.log('[ok] single question answer:', single.answer.slice(0, 180).replace(/\s+/g, ' '))

  const all = await ask(token, conversationId, 'Answer all questions')
  if (all.error) throw new Error(`answer-all chat error: ${JSON.stringify(all.error)}`)
  if (all.citations?.mode !== 'document') {
    throw new Error(`answer-all used mode ${all.citations?.mode}`)
  }
  for (const expected of [/question\s*1/i, /question\s*2/i, /question\s*3/i, /paris/i, /photosynthesis/i, /\b4\b|four/i]) {
    if (!expected.test(all.answer)) {
      throw new Error(`answer-all missing ${expected}: ${all.answer.slice(0, 500)}`)
    }
  }
  console.log('[ok] answer-all covered every question:', all.answer.slice(0, 240).replace(/\s+/g, ' '))

  const second = await ask(token, conversationId, 'answer question 2')
  if (second.error) throw new Error(`second question chat error: ${JSON.stringify(second.error)}`)
  if (!/photosynthesis|chemical energy|oxygen/i.test(second.answer)) {
    throw new Error(`second-question answer was not grounded: ${second.answer.slice(0, 300)}`)
  }
  console.log('[ok] question 2 answer grounded')
} finally {
  for (const documentId of documentIds) {
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
}
