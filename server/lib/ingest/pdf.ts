import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')

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
  // pdf-parse can render per page if we pass options; default gives text
  const data = await pdfParse(buffer)
  const text = typeof data.text === 'string' ? data.text : ''
  const numpages = typeof data.numpages === 'number' ? data.numpages : 0
  // pdf-parse doesn't always split cleanly by page in all versions; try to split by form feed
  const pages: PdfPage[] = []
  if (text.includes('\f')) {
    const parts = text.split('\f')
    for (let i = 0; i < parts.length; i++) {
      const t = parts[i]
      if (typeof t === 'string' && t.trim().length > 0) {
        pages.push({ pageNumber: i + 1, text: t })
      } else if (typeof t === 'string' && parts.length === numpages) {
        // keep empty page if count matches
        pages.push({ pageNumber: i + 1, text: t })
      }
    }
  }
  if (pages.length === 0 && text.trim().length > 0) {
    // fallback: single page or unknown
    pages.push({ pageNumber: 1, text })
  }
  return { text, pages, numpages, info: data.info }
}
