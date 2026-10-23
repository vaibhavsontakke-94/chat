import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth/AuthProvider'
import type { Citation } from '../types/chat'

export interface PersistedConversation {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export interface PersistedMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  model: string | null
  created_at: string
  metadata?: { citations?: Citation[] } | null
}

export interface MessagePage {
  messages: PersistedMessage[]
  hasMore: boolean
  nextCursor: string | null
}

export interface MessageInput {
  role: 'user' | 'assistant'
  content: string
  model?: string | null
  clientMessageId?: string
  citations?: Citation[]
}

const PAGE_SIZE = 50

export function useConversations() {
  const { enabled, user, getAccessToken } = useAuth()
  const [error, setError] = useState<string | null>(null)

  const reportFailure = useCallback((response: Response) => {
    if (response.status === 401) {
      setError('Your private session expired. Reload the page to continue.')
      return
    }
    if (response.status === 503) {
      setError('Chat history is not configured on the server.')
      return
    }
    setError(
      'Chat history is unavailable. Apply migrations/001_auth_chat_history.sql and 004_history_pagination_and_scoped_rag.sql in Supabase, then reload.',
    )
  }, [])

  const authFetch = useCallback(
    async (input: RequestInfo, init: RequestInit = {}) => {
      const token = getAccessToken()
      const headers = new Headers(init.headers || {})
      headers.set('Content-Type', 'application/json')
      if (token) headers.set('Authorization', `Bearer ${token}`)
      return fetch(input, { ...init, headers })
    },
    [getAccessToken],
  )

  const list = useCallback(async (): Promise<PersistedConversation[]> => {
    if (!enabled || !user) return []
    try {
      const res = await authFetch('/api/conversations?limit=100')
      if (!res.ok) {
        reportFailure(res)
        return []
      }
      setError(null)
      const json = await res.json()
      return json.conversations ?? []
    } catch {
      setError('Could not reach the chat server to load history.')
      return []
    }
  }, [authFetch, enabled, reportFailure, user])

  const create = useCallback(
    async (title?: string, clientId?: string): Promise<PersistedConversation | null> => {
      if (!enabled || !user) return null
      try {
        const res = await authFetch('/api/conversations', {
          method: 'POST',
          body: JSON.stringify({ title, clientId }),
        })
        if (!res.ok) {
          reportFailure(res)
          return null
        }
        setError(null)
        const json = await res.json()
        return json.conversation ?? null
      } catch {
        setError('Could not reach the chat server to save history.')
        return null
      }
    },
    [authFetch, enabled, reportFailure, user],
  )

  const rename = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      if (!enabled || !user) return false
      try {
        const res = await authFetch(`/api/conversations/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ title }),
        })
        if (!res.ok) reportFailure(res)
        else setError(null)
        return res.ok
      } catch {
        setError('Could not reach the chat server to rename this chat.')
        return false
      }
    },
    [authFetch, enabled, reportFailure, user],
  )

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      if (!enabled || !user) return false
      try {
        const res = await authFetch(`/api/conversations/${id}`, { method: 'DELETE' })
        if (!res.ok) reportFailure(res)
        else setError(null)
        return res.ok
      } catch {
        setError('Could not reach the chat server to delete this chat.')
        return false
      }
    },
    [authFetch, enabled, reportFailure, user],
  )

  const addMessage = useCallback(
    async (conversationId: string, message: MessageInput): Promise<boolean> => {
      if (!enabled || !user) return false
      try {
        const res = await authFetch(`/api/conversations/${conversationId}/messages`, {
          method: 'POST',
          body: JSON.stringify(message),
        })
        if (!res.ok) reportFailure(res)
        else setError(null)
        return res.ok
      } catch {
        setError('Could not reach the chat server to save this message.')
        return false
      }
    },
    [authFetch, enabled, reportFailure, user],
  )

  const loadMessages = useCallback(
    async (id: string, options: { limit?: number; before?: string | null } = {}): Promise<MessagePage> => {
      const empty: MessagePage = { messages: [], hasMore: false, nextCursor: null }
      if (!enabled || !user) return empty
      try {
        const params = new URLSearchParams({ limit: String(options.limit ?? PAGE_SIZE) })
        if (options.before) params.set('before', options.before)
        const res = await authFetch(`/api/conversations/${id}?${params.toString()}`)
        if (!res.ok) {
          reportFailure(res)
          return empty
        }
        setError(null)
        const json = await res.json()
        return {
          messages: json.messages ?? [],
          hasMore: json.hasMore === true,
          nextCursor: typeof json.nextCursor === 'string' ? json.nextCursor : null,
        }
      } catch {
        setError('Could not reach the chat server to load this conversation.')
        return empty
      }
    },
    [authFetch, enabled, reportFailure, user],
  )

  return useMemo(
    () => ({
      enabled,
      signedIn: !!user,
      error,
      clearError: () => setError(null),
      list,
      create,
      rename,
      remove,
      addMessage,
      loadMessages,
    }),
    [enabled, error, user, list, create, rename, remove, addMessage, loadMessages],
  )
}
