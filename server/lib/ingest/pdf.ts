import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

interface PdfTextPage {
  num: number
  text: string
}

interface PdfTextResult {
  text: string
  pages: PdfTextPage[]
  total: number
}

interface PdfParser {
  getText(params?: { pageJoiner?: string }): Promise<PdfTextResult>
  destroy(): Promise<void>
}

const { PDFParse } = require('pdf-parse') as {
  PDFParse: new (options: { data: Buffer | Uint8Array }) => PdfParser
}

export interface PdfPage {
  pageNumber: number
  text: string
}

export interface PdfExtractResult {
  text: string
  pages: PdfPage[]
  numpages: number
  info?: unknown
}

export async function extractPdf(buffer: Buffer): Promise<PdfExtractResult> {
  // pdf-parse v2 exports a PDFParse class; v1 exported a callable function.
  const parser = new PDFParse({ data: buffer })
  try {
    const data = await parser.getText({ pageJoiner: '' })
    const text = typeof data.text === 'string' ? data.text : ''
    const numpages = typeof data.total === 'number' ? data.total : 0
    const pages: PdfPage[] = Array.isArray(data.pages)
      ? data.pages
          .filter((page) => page && typeof page.text === 'string')
          .map((page) => ({ pageNumber: page.num, text: page.text }))
      : []
    if (pages.length === 0 && text.trim().length > 0) {
      // Fallback for versions that only return concatenated text.
      pages.push({ pageNumber: 1, text })
    }
    return { text, pages, numpages }
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}
