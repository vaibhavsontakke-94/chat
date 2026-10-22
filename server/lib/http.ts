import type { IncomingMessage, ServerResponse } from 'node:http'
import { HttpError } from './errors.ts'

export interface JsonBodyResult {
  ok: boolean
  value?: unknown
  error?: HttpError
}

export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<JsonBodyResult> {
  const contentType = req.headers['content-type'] ?? ''
  if (!contentType.includes('application/json')) {
    return {
      ok: false,
      error: new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json.'),
    }
  }

  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > maxBytes) {
      return {
        ok: false,
        error: new HttpError(413, 'payload_too_large', `Request body exceeds ${maxBytes} bytes.`),
      }
    }
    chunks.push(buffer)
  }

  if (size === 0) {
    return { ok: false, error: new HttpError(400, 'invalid_json', 'Request body is empty.') }
  }

  try {
    const text = Buffer.concat(chunks).toString('utf8')
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, error: new HttpError(400, 'invalid_json', 'Request body is not valid JSON.') }
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

export function sendError(res: ServerResponse, error: HttpError): void {
  sendJson(res, error.status, { error: { code: error.code, message: error.message } })
}

export interface SseWriter {
  event(name: string, data: unknown): void
  close(): void
}

export function openSse(res: ServerResponse): SseWriter {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  // Tell the client the stream is live so it can flush early.
  res.write(': open\n\n')

  let closed = false

  return {
    event(name, data) {
      if (closed) return
      res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    },
    close() {
      if (closed) return
      closed = true
      res.end()
    },
  }
}

export function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown'
  }
  return req.socket.remoteAddress ?? 'unknown'
}

export function isOriginAllowed(req: IncomingMessage, allowedOrigins: string[]): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  return allowedOrigins.includes(origin)
}
