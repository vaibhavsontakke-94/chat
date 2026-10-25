import { createRequire } from 'node:module'
import { extname } from 'node:path'
import { extractPdf } from './pdf.ts'
import { countPdfPages, ocrPdfPages } from './pdfOcr.ts'
import { ocrImage } from './ocr.ts'

const require = createRequire(import.meta.url)
const mammoth = require('mammoth') as {
  extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>
}

export type DocumentKind = 'pdf' | 'docx' | 'text' | 'html' | 'image'

interface FileType {
  kind: DocumentKind
  mimeType: string
}

const FILE_TYPES: Record<string, FileType> = {
  '.pdf': { kind: 'pdf', mimeType: 'application/pdf' },
  '.docx': {
    kind: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  '.txt': { kind: 'text', mimeType: 'text/plain' },
  '.md': { kind: 'text', mimeType: 'text/markdown' },
  '.markdown': { kind: 'text', mimeType: 'text/markdown' },
  '.csv': { kind: 'text', mimeType: 'text/csv' },
  '.json': { kind: 'text', mimeType: 'application/json' },
  '.html': { kind: 'html', mimeType: 'text/html' },
  '.htm': { kind: 'html', mimeType: 'text/html' },
  '.png': { kind: 'image', mimeType: 'image/png' },
  '.jpg': { kind: 'image', mimeType: 'image/jpeg' },
  '.jpeg': { kind: 'image', mimeType: 'image/jpeg' },
}

export interface ExtractedPage {
  pageNumber: number
  text: string
}

export interface ExtractedDocument {
  text: string
  pages: ExtractedPage[]
  numpages: number
  kind: DocumentKind
  ocrUsed: boolean
}

export class DocumentExtractionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DocumentExtractionError'
    this.code = code
  }
}

export function resolveDocumentType(
  filename: string,
  contentType?: string | null,
): FileType | null {
  const extension = extname(filename).toLowerCase()
  const byExtension = FILE_TYPES[extension]
  if (byExtension) return byExtension

  const mimeType = contentType?.split(';')[0]?.trim().toLowerCase()
  if (!mimeType) return null
  return Object.values(FILE_TYPES).find((type) => type.mimeType === mimeType) ?? null
}

export function isSupportedDocument(filename: string, contentType?: string | null): boolean {
  return resolveDocumentType(filename, contentType) !== null
}

function decodeText(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8').replace(/^\uFEFF/, '')
  if (!utf8.includes('\uFFFD')) return utf8
  return buffer.toString('latin1').replace(/^\uFEFF/, '')
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
}

function singlePage(text: string): ExtractedPage[] {
  return [{ pageNumber: 1, text }]
}

async function extractPdfDocument(buffer: Buffer): Promise<ExtractedDocument> {
  let pdf
  try {
    pdf = await extractPdf(buffer)
  } catch {
    try {
      const numpages = await countPdfPages(buffer)
      const ocrPages = await ocrPdfPages(
        buffer,
        Array.from({ length: numpages }, (_, index) => index + 1),
      )
      const pages = Array.from({ length: numpages }, (_, index) => ({
        pageNumber: index + 1,
        text: ocrPages.get(index + 1) ?? '',
      }))
      const text = pages
        .map((page) => page.text.trim())
        .filter(Boolean)
        .join('\n\n')
      if (text.length === 0) {
        throw new DocumentExtractionError(
          'ocr_failed',
          'No text could be read from the scanned PDF. OCR found no readable text.',
        )
      }
      return { text, pages, numpages, kind: 'pdf', ocrUsed: true }
    } catch (error) {
      if (error instanceof DocumentExtractionError) throw error
      throw new DocumentExtractionError(
        'pdf_invalid',
        'Could not read the PDF. The file may be encrypted or malformed.',
      )
    }
  }

  let pages: ExtractedPage[] =
    pdf.pages.length > 0
      ? pdf.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text }))
      : pdf.text.trim().length > 0
        ? singlePage(pdf.text)
        : Array.from({ length: Math.max(1, pdf.numpages) }, (_, index) => ({
            pageNumber: index + 1,
            text: '',
          }))

  const blankPages = pages
    .filter((page) => page.text.trim().length < 8)
    .map((page) => page.pageNumber)
  let ocrUsed = false

  if (blankPages.length > 0) {
    try {
      const ocrPages = await ocrPdfPages(buffer, blankPages)
      if (ocrPages.size > 0) {
        ocrUsed = true
        pages = pages.map((page) => {
          const recognized = ocrPages.get(page.pageNumber)
          if (!recognized) return page
          return {
            ...page,
            text: [page.text.trim(), recognized.trim()].filter(Boolean).join('\n'),
          }
        })
      }
    } catch (error) {
      if (process.env.DEBUG_OCR) console.error('[ocr:pdf]', error)
      if (pages.every((page) => page.text.trim().length === 0)) {
        throw new DocumentExtractionError(
          'ocr_failed',
          'No text could be read from the scanned PDF. OCR failed or found no readable text.',
        )
      }
    }
  }

  const text = pages
    .map((page) => page.text.trim())
    .filter(Boolean)
    .join('\n\n')

  return {
    text,
    pages,
    numpages: Math.max(pdf.numpages, pages.length),
    kind: 'pdf',
    ocrUsed,
  }
}

async function extractDocx(buffer: Buffer): Promise<ExtractedDocument> {
  let text = ''
  try {
    const result = await mammoth.extractRawText({ buffer })
    text = typeof result.value === 'string' ? result.value : ''
  } catch {
    throw new DocumentExtractionError(
      'docx_invalid',
      'Could not read the DOCX file. The file may be malformed or password-protected.',
    )
  }
  return { text, pages: singlePage(text), numpages: 1, kind: 'docx', ocrUsed: false }
}

async function extractImage(buffer: Buffer): Promise<ExtractedDocument> {
  let text = ''
  try {
    text = await ocrImage(buffer)
  } catch {
    throw new DocumentExtractionError(
      'ocr_failed',
      'OCR could not read this image. Try a clearer PNG or JPEG.',
    )
  }
  return { text, pages: singlePage(text), numpages: 1, kind: 'image', ocrUsed: true }
}

export async function extractDocument(input: {
  buffer: Buffer
  filename: string
  contentType?: string | null
}): Promise<ExtractedDocument> {
  const type = resolveDocumentType(input.filename, input.contentType)
  if (!type) {
    throw new DocumentExtractionError(
      'unsupported_type',
      'Unsupported document type. Use PDF, DOCX, TXT, MD, CSV, JSON, HTML, PNG, or JPG.',
    )
  }

  if (type.kind === 'pdf') return extractPdfDocument(input.buffer)
  if (type.kind === 'docx') return extractDocx(input.buffer)
  if (type.kind === 'image') return extractImage(input.buffer)

  const decoded = decodeText(input.buffer).replaceAll('\u0000', '')
  const text = type.kind === 'html' ? htmlToText(decoded) : decoded
  return { text, pages: singlePage(text), numpages: 1, kind: type.kind, ocrUsed: false }
}
