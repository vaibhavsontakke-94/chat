import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, isGroqConfigured } from './config.ts'
import { SERVER_NAME, SERVER_VERSION } from './constants.ts'
import { HttpError, ProviderError } from './lib/errors.ts'
import { isOriginAllowed, sendError, sendJson } from './lib/http.ts'
import { listChatModels } from './lib/groq.ts'
import { pruneRateLimits } from './lib/rateLimit.ts'
import { serveStatic } from './lib/static.ts'
import { handleChat } from './routes/chat.ts'
import { handleConversations } from './routes/conversations/index.ts'
import { handleDocuments } from './routes/documents/index.ts'

const config = loadConfig()
const here = dirname(fileURLToPath(import.meta.url))
const clientDist = join(here, '..', 'dist')
const hasClientBuild = existsSync(join(clientDist, 'index.html'))

const server = createServer((req, res) => {
  void handleRequest(req, res)
})

async function handleRequest(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  const url = req.url ?? '/'
  const [path = '/', query = ''] = url.split('?')
  const searchParams = new URLSearchParams(query)

  try {
    if (path.startsWith('/api/')) {
      if (!isOriginAllowed(req, config.allowedOrigins)) {
        sendError(res, new HttpError(403, 'origin_not_allowed', 'Request origin is not allowed.'))
        return
      }

      if (req.method === 'GET' && path === '/api/health') {
        sendJson(res, 200, {
          status: 'ok',
          server: SERVER_NAME,
          version: SERVER_VERSION,
          provider: isGroqConfigured(config) ? 'groq' : 'unconfigured',
          model: config.groqChatModel,
        })
        return
      }

      if (req.method === 'GET' && path === '/api/models') {
        if (!isGroqConfigured(config)) {
          sendJson(res, 200, {
            configured: false,
            active: config.groqChatModel,
            models: [],
          })
          return
        }
        try {
          const models = await listChatModels(config)
          sendJson(res, 200, { configured: true, active: config.groqChatModel, models })
        } catch (error) {
          const message = error instanceof ProviderError ? error.message : 'Could not load models.'
          sendJson(res, 200, { configured: true, active: config.groqChatModel, models: [], error: message })
        }
        return
      }

      if (req.method === 'POST' && path === '/api/chat') {
        await handleChat(req, res, config)
        return
      }

      if (path.startsWith('/api/conversations')) {
        await handleConversations(req, res, config, path, searchParams)
        return
      }

      if (path.startsWith('/api/documents')) {
        await handleDocuments(req, res, config, path, searchParams)
        return
      }

      sendError(res, new HttpError(404, 'not_found', 'Unknown API route.'))
      return
    }

    if (req.method === 'GET' && hasClientBuild) {
      const served = await serveStatic(clientDist, path, res)
      if (served) return
    }

    sendJson(res, 404, {
      error: {
        code: 'not_found',
        message: hasClientBuild
          ? 'Not found.'
          : 'Client build not found. Run `npm run build` or use the Vite dev server.',
      },
    })
  } catch {
    if (!res.headersSent) {
      sendError(res, new HttpError(500, 'internal_error', 'Unexpected server error.'))
    } else {
      res.end()
    }
  }
}

const pruneTimer = setInterval(pruneRateLimits, 60_000)
pruneTimer.unref()

server.listen(config.port, () => {
  const provider = isGroqConfigured(config) ? 'groq' : 'not configured'
  console.log(`[${SERVER_NAME}] v${SERVER_VERSION} listening on http://localhost:${config.port}`)
  console.log(`[${SERVER_NAME}] provider: ${provider}`)
  if (!isGroqConfigured(config)) {
    console.warn(`[${SERVER_NAME}] GROQ_API_KEY is missing - set it in .env to enable chat.`)
  }
  if (!hasClientBuild) {
    console.log(`[${SERVER_NAME}] serving API only; use the Vite dev server for the client.`)
  }
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
