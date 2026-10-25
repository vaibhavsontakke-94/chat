import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { EMBEDDING_DIMENSIONS, embedText } from '../lib/ingest/embeddings.ts'
import { extractDocument, resolveDocumentType } from '../lib/ingest/extract.ts'
import { extractPdf } from '../lib/ingest/pdf.ts'

const require = createRequire(import.meta.url)
const JSZip = require('jszip') as {
  new (): {
    file(name: string, content: string): void
    generateAsync(options: { type: 'nodebuffer' }): Promise<Buffer>
  }
}

function makePdf(lines: string[]): Buffer {
  let stream = 'BT /F1 12 Tf 72 720 Td '
  lines.forEach((line, index) => {
    const escaped = line.replace(/[()\\]/g, (character) => `\\${character}`)
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

test('extractPdf reads page text with pdf.js', async () => {
  const result = await extractPdf(
    makePdf(['Nyra AI document upload test.', 'The quick brown fox jumps over the lazy dog.']),
  )

  assert.equal(result.numpages, 1)
  assert.equal(result.pages.length, 1)
  assert.match(result.text, /quick brown fox/)
  assert.match(result.pages[0]?.text ?? '', /lazy dog/)
})

test('extractPdf reports no text for an empty PDF', async () => {
  const result = await extractPdf(makePdf([]))

  assert.equal(result.numpages, 1)
  assert.equal(result.text.trim(), '')
})

async function makeDocx(text: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>` +
      '</w:document>',
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

test('extractDocument reads text and strips HTML', async () => {
  const text = await extractDocument({
    filename: 'notes.txt',
    contentType: 'text/plain',
    buffer: Buffer.from('Plain text document about orbital launches.'),
  })
  assert.equal(text.kind, 'text')
  assert.match(text.text, /orbital launches/)

  const html = await extractDocument({
    filename: 'notes.html',
    contentType: 'text/html',
    buffer: Buffer.from(
      '<h1>Launch notes</h1><script>ignoreMe()</script><p>Code &amp; window</p>',
    ),
  })
  assert.equal(html.kind, 'html')
  assert.match(html.text, /Launch notes/)
  assert.match(html.text, /Code & window/)
  assert.doesNotMatch(html.text, /ignoreMe/)
})

test('extractDocument reads DOCX text', async () => {
  const buffer = await makeDocx('DOCX launch code is ORBITAL-42.')
  const result = await extractDocument({
    filename: 'notes.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer,
  })

  assert.equal(result.kind, 'docx')
  assert.match(result.text, /ORBITAL-42/)
})

test('resolveDocumentType supports common documents and images', () => {
  assert.equal(resolveDocumentType('a.pdf')?.kind, 'pdf')
  assert.equal(resolveDocumentType('a.docx')?.kind, 'docx')
  assert.equal(resolveDocumentType('a.csv')?.kind, 'text')
  assert.equal(resolveDocumentType('a.png')?.kind, 'image')
  assert.equal(resolveDocumentType('a.jpg')?.kind, 'image')
  assert.equal(resolveDocumentType('a.exe'), null)
})

test('local embeddings are deterministic, normalized, and 768-dimensional', async () => {
  const previous = process.env.EMBEDDINGS_PROVIDER
  process.env.EMBEDDINGS_PROVIDER = 'local'

  try {
    const [first] = await embedText(['vector embeddings and retrieval'], {} as never)
    const [second] = await embedText(['vector embeddings and retrieval'], {} as never)

    assert.equal(first.length, EMBEDDING_DIMENSIONS)
    assert.deepEqual(first, second)
    const norm = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0))
    assert.ok(Math.abs(norm - 1) < 1e-9)
  } finally {
    if (previous === undefined) delete process.env.EMBEDDINGS_PROVIDER
    else process.env.EMBEDDINGS_PROVIDER = previous
  }
})

function withFetch<T>(replacement: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = replacement
  return run().finally(() => {
    globalThis.fetch = original
  })
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

test('huggingface MiniLM embeddings are normalized and padded to 768 dimensions', async () => {
  const previous = {
    provider: process.env.EMBEDDINGS_PROVIDER,
    token: process.env.HF_TOKEN,
    model: process.env.HF_EMBEDDING_MODEL,
  }
  process.env.EMBEDDINGS_PROVIDER = 'huggingface'
  process.env.HF_TOKEN = 'test-token'
  process.env.HF_EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2'

  const miniLm = Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0))
  let requestedUrl = ''

  try {
    const [vector] = await withFetch(
      (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        requestedUrl = String(input)
        const body = JSON.parse(String(init?.body)) as { inputs: string[] }
        assert.deepEqual(body.inputs, ['hello world'])
        return new Response(JSON.stringify({ embeddings: [miniLm] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }) as typeof fetch,
      () => embedText(['hello world'], {} as never),
    )

    assert.match(requestedUrl, /sentence-transformers\/all-MiniLM-L6-v2/)
    assert.equal(vector.length, EMBEDDING_DIMENSIONS)
    assert.equal(vector[0], 1)
    assert.equal(vector[400], 0)
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    assert.ok(Math.abs(norm - 1) < 1e-9)
  } finally {
    restoreEnv('EMBEDDINGS_PROVIDER', previous.provider)
    restoreEnv('HF_TOKEN', previous.token)
    restoreEnv('HF_EMBEDDING_MODEL', previous.model)
  }
})

test('huggingface permission errors explain how to fix the token', async () => {
  const previous = {
    provider: process.env.EMBEDDINGS_PROVIDER,
    token: process.env.HF_TOKEN,
  }
  process.env.EMBEDDINGS_PROVIDER = 'huggingface'
  process.env.HF_TOKEN = 'test-token'

  try {
    await assert.rejects(
      withFetch(
        (async () =>
          new Response(JSON.stringify({ error: 'insufficient permissions' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          })) as typeof fetch,
        () => embedText(['hello world'], {} as never),
      ),
      /Inference Providers/,
    )
  } finally {
    restoreEnv('EMBEDDINGS_PROVIDER', previous.provider)
    restoreEnv('HF_TOKEN', previous.token)
  }
})

test('google Gemini embeddings use the batch endpoint with 768 dimensions', async () => {
  const previous = {
    provider: process.env.EMBEDDINGS_PROVIDER,
    key: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_EMBEDDING_MODEL,
  }
  process.env.EMBEDDINGS_PROVIDER = 'google'
  process.env.GEMINI_API_KEY = 'test-key'
  process.env.GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001'

  const gemini = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) =>
    index === 0 ? 1 : 0,
  )
  let requestedUrl = ''
  let requestedInit: Parameters<typeof fetch>[1]

  try {
    const [vector] = await withFetch(
      (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        requestedUrl = String(input)
        requestedInit = init
        const body = JSON.parse(String(init?.body)) as {
          requests: Array<Record<string, unknown>>
        }
        assert.equal(body.requests.length, 1)
        assert.equal(body.requests[0]?.taskType, 'RETRIEVAL_DOCUMENT')
        assert.equal(body.requests[0]?.outputDimensionality, EMBEDDING_DIMENSIONS)
        return new Response(JSON.stringify({ embeddings: [{ values: gemini }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }) as typeof fetch,
      () => embedText(['hello world'], {} as never, { taskType: 'document' }),
    )

    assert.match(requestedUrl, /gemini-embedding-001:batchEmbedContents/)
    const headers = requestedInit?.headers as Record<string, string>
    assert.equal(headers['x-goog-api-key'], 'test-key')
    assert.equal(vector.length, EMBEDDING_DIMENSIONS)
    assert.equal(vector[0], 1)
  } finally {
    restoreEnv('EMBEDDINGS_PROVIDER', previous.provider)
    restoreEnv('GEMINI_API_KEY', previous.key)
    restoreEnv('GEMINI_EMBEDDING_MODEL', previous.model)
  }
})

test('google Gemini uses RETRIEVAL_QUERY for retrieval queries', async () => {
  const previous = {
    provider: process.env.EMBEDDINGS_PROVIDER,
    key: process.env.GEMINI_API_KEY,
  }
  process.env.EMBEDDINGS_PROVIDER = 'google'
  process.env.GEMINI_API_KEY = 'test-key'

  const gemini = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) =>
    index === 0 ? 1 : 0,
  )
  let requestedTaskType: unknown

  try {
    await withFetch(
      (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const body = JSON.parse(String(init?.body)) as {
          requests: Array<{ taskType?: unknown }>
        }
        requestedTaskType = body.requests[0]?.taskType
        return new Response(JSON.stringify({ embeddings: [{ values: gemini }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }) as typeof fetch,
      () => embedText(['what is retrieval?'], {} as never, { taskType: 'query' }),
    )

    assert.equal(requestedTaskType, 'RETRIEVAL_QUERY')
  } finally {
    restoreEnv('EMBEDDINGS_PROVIDER', previous.provider)
    restoreEnv('GEMINI_API_KEY', previous.key)
  }
})
