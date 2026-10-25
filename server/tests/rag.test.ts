import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRagPrompt } from '../lib/rag/prompt.ts'
import { expandVagueDocumentQuestion } from '../lib/rag/router.ts'
import { filterRetrievedChunks, type RetrievedChunk } from '../lib/rag/retrieve.ts'

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunk_id: 'chunk-1',
    document_id: 'doc-1',
    filename: 'notes.pdf',
    page_number: 2,
    chunk_index: 0,
    content: 'The project code name is ORBITAL-42.',
    metadata: {},
    similarity: 0.62,
    ...overrides,
  }
}

test('expandVagueDocumentQuestion expands short overview prompts', () => {
  assert.match(expandVagueDocumentQuestion('about'), /Summarize its main topics/)
  assert.match(expandVagueDocumentQuestion('answer'), /Summarize its main topics/)
  assert.match(expandVagueDocumentQuestion('what is this?'), /Summarize its main topics/)
  assert.equal(
    expandVagueDocumentQuestion('What is the project code name?'),
    'What is the project code name?',
  )
})

test('filterRetrievedChunks enforces document scope, threshold, and topK', () => {
  const chunks = [
    chunk({ chunk_id: 'a', similarity: 0.9 }),
    chunk({ chunk_id: 'b', similarity: 0.5, document_id: 'doc-2' }),
    chunk({ chunk_id: 'c', similarity: 0.1 }),
    chunk({ chunk_id: 'd', similarity: 0.8 }),
  ]

  const result = filterRetrievedChunks(chunks, {
    documentIds: ['doc-1'],
    threshold: 0.2,
    topK: 1,
  })

  assert.deepEqual(
    result.map((item) => item.chunk_id),
    ['a'],
  )
})

test('buildRagPrompt includes context guidance and citations', () => {
  const { prompt, citations } = buildRagPrompt('about', [chunk()], 'document')

  assert.equal(citations.length, 1)
  assert.match(prompt, /ORBITAL-42/)
  assert.match(prompt, /Do not claim information is missing/)
  assert.match(prompt, /summarize the relevant topics/i)
})

test('buildRagPrompt only uses the exact fallback wording when context is empty', () => {
  const withContext = buildRagPrompt('about', [chunk()], 'document').prompt
  assert.match(withContext, /I could not find this information in the provided documents\./)

  const withoutContext = buildRagPrompt('about', [], 'document').prompt
  assert.match(withoutContext, /could not find this information/)
})
