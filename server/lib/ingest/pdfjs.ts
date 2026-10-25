import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
let workerSrc: string | null = null

function getWorkerSrc(): string {
  workerSrc ??= pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href
  return workerSrc
}

const globals = globalThis as unknown as Record<string, unknown>
if (!globals.DOMMatrix) globals.DOMMatrix = DOMMatrix
if (!globals.ImageData) globals.ImageData = ImageData
if (!globals.Path2D) globals.Path2D = Path2D

export interface LoadedPdf {
  loadingTask: { destroy(): Promise<void> }
  pdf: {
    numPages: number
    getPage(pageNumber: number): Promise<any>
  }
}

export async function loadPdf(buffer: Buffer): Promise<LoadedPdf> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = getWorkerSrc()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  })
  return { loadingTask, pdf: await loadingTask.promise }
}
