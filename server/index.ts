import { loadConfig, isGroqConfigured } from './config.ts'
import { SERVER_NAME, SERVER_VERSION } from './constants.ts'
import { HttpError, ProviderError } from './lib/errors.ts'
import { isOriginAllowed, sendError, sendJson } from './lib/http.ts'
import { listChatModels } from './lib/groq.ts'
import { handleChat } from './routes/chat.ts'
import { handleConversations } from './routes/conversations/index.ts'
import { handleDocuments } from './routes/documents/index.ts'

const config = loadConfig()
const isVercel = process.env.VERCEL === '1'

export default async function handler(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  if (isVercel) {
    // Vercel serverless function: route based on path
    const url = req.url ?? '/'
    const path = url.replace(/^\//, '/')

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (path.startsWith('/api/')) {
      if (!isOriginAllowed(req, [])) {
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
          return
        } catch (error) {
          const message = error instanceof ProviderError ? error.message : 'Could not load models.'
          sendJson(res, 200, { configured: true, active: config.groqChatModel, models: [], error: message })
          return
        }
      }

      if (req.method === 'POST' && path === '/api/chat') {
        await handleChat(req, res, config)
        return
      }

      if (path.startsWith('/api/conversations')) {
        await handleConversations(req, res, config, path, new URLSearchParams())
        return
      }

      if (path.startsWith('/api/documents')) {
        await handleDocuments(req, res, config, path, new URLSearchParams())
        return
      }

      sendError(res, new HttpError(404, 'not_found', 'Unknown API route.'))
      return
    }

    // SPA fallback
    sendJson(res, 200, { status: 'ok', server: SERVER_NAME })
  } else {
    // Local development mode - health check
    sendJson(res, 200, {
      status: 'ok',
      server: SERVER_NAME,
      version: SERVER_VERSION,
      provider: isGroqConfigured(config) ? 'groq' : 'unconfigured',
      model: config.groqChatModel,
    })
  }
}