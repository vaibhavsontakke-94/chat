import { loadPdf } from './pdfjs.ts'

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
  const { loadingTask, pdf } = await loadPdf(buffer)
  try {
    const pages: PdfPage[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      try {
        const content = await page.getTextContent()
        const text = content.items
          .map((item: { str?: string }) => (typeof item.str === 'string' ? item.str : ''))
          .join(' ')
          .replace(/[ \t]+/g, ' ')
          .replace(/ *\n */g, '\n')
          .trim()
        pages.push({ pageNumber, text })
      } finally {
        page.cleanup()
      }
    }

    const text = pages
      .map((page) => page.text)
      .filter(Boolean)
      .join('\n\n')
    return { text, pages, numpages: pdf.numPages }
  } finally {
    await loadingTask.destroy()
  }
}
