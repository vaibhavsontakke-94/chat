import { createWorker, type Worker } from 'tesseract.js'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let workerPromise: Promise<Worker> | null = null
let queue: Promise<unknown> = Promise.resolve()

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    const language = process.env.TESSERACT_LANG?.trim() || 'eng'
    const cachePath = process.env.TESSERACT_CACHE_PATH?.trim() || join(tmpdir(), 'nyra-tesseract')
    workerPromise = createWorker(language, 1, { cachePath }).catch((error) => {
      workerPromise = null
      throw error
    })
  }
  return workerPromise
}

export function ocrImage(buffer: Buffer): Promise<string> {
  const task = queue.then(async () => {
    const worker = await getWorker()
    const result = await worker.recognize(buffer)
    return typeof result.data.text === 'string' ? result.data.text : ''
  })
  queue = task.then(
    () => undefined,
    () => undefined,
  )
  return task
}

export async function terminateOcr(): Promise<void> {
  const pending = workerPromise
  workerPromise = null
  if (!pending) return
  try {
    const worker = await pending
    await worker.terminate()
  } catch {
    // Worker may have failed to start.
  }
}
