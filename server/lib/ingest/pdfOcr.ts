import { createCanvas } from '@napi-rs/canvas'
import { ocrImage } from './ocr.ts'
import { loadPdf } from './pdfjs.ts'

const MAX_RENDER_PIXELS = 16_000_000

export async function countPdfPages(buffer: Buffer): Promise<number> {
  const { loadingTask, pdf } = await loadPdf(buffer)
  try {
    return typeof pdf.numPages === 'number' ? pdf.numPages : 0
  } finally {
    await loadingTask.destroy()
  }
}

export async function ocrPdfPages(
  buffer: Buffer,
  pageNumbers: number[],
): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  if (pageNumbers.length === 0) return result

  const { loadingTask, pdf } = await loadPdf(buffer)
  try {
    for (const pageNumber of pageNumbers) {
      if (pageNumber < 1 || pageNumber > pdf.numPages) continue
      const page = await pdf.getPage(pageNumber)
      try {
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(
          2,
          Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, base.width * base.height)),
        )
        const viewport = page.getViewport({ scale })
        const canvas = createCanvas(
          Math.max(1, Math.ceil(viewport.width)),
          Math.max(1, Math.ceil(viewport.height)),
        )
        const context = canvas.getContext('2d')
        await page.render({ canvasContext: context, viewport }).promise
        const png = canvas.toBuffer('image/png')
        const text = (await ocrImage(png)).trim()
        if (text.length > 0) result.set(pageNumber, text)
      } finally {
        page.cleanup()
      }
    }
  } finally {
    await loadingTask.destroy()
  }

  return result
}
