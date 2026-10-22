import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Serves the built client from `dist`.
 * Unknown paths fall back to `index.html` so client-side routing keeps working.
 */
export async function serveStatic(root: string, urlPath: string, res: ServerResponse): Promise<boolean> {
  const rootPath = resolve(root)
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/')
  const candidate = resolve(join(rootPath, normalize(decoded)))

  const isInsideRoot = candidate === rootPath || candidate.startsWith(rootPath + sep)
  if (isInsideRoot) {
    const info = await stat(candidate).catch(() => null)
    if (info?.isFile()) {
      res.writeHead(200, {
        'Content-Type': contentTypeFor(candidate),
        'Content-Length': info.size,
        'Cache-Control': candidate.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      })
      createReadStream(candidate).pipe(res)
      return true
    }
  }

  const indexPath = join(rootPath, 'index.html')
  const indexInfo = await stat(indexPath).catch(() => null)
  if (!indexInfo?.isFile()) return false

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
  })
  createReadStream(indexPath).pipe(res)
  return true
}
