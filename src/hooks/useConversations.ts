import { useAuth } from './AuthProvider'

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
}

async function authFetch(input: RequestInfo, init: RequestInit = {}, getToken: () => string | null) {
  const token = getToken()
  const headers = new Headers(init.headers || {})
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}

export function useConversations() {
  const { enabled, user, getAccessToken } = useAuth()

  const list = async (): Promise<PersistedConversation[]> => {
    if (!enabled || !user) return []
    const res = await authFetch('/api/conversations', {}, getAccessToken)
    if (!res.ok) throw new Error('Failed to load conversations')
    const json = await res.json()
    return json.conversations ?? []
  }

  const create = async (title?: string): Promise<PersistedConversation | null> => {
    if (!enabled || !user) return null
    const res = await authFetch('/api/conversations', { method: 'POST', body: JSON.stringify({ title }) }, getAccessToken)
    if (!res.ok) return null
    const json = await res.json()
    return json.conversation ?? null
  }

  const rename = async (id: string, title: string): Promise<boolean> => {
    if (!enabled || !user) return false
    const res = await authFetch(`/api/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }, getAccessToken)
    return res.ok
  }

  const remove = async (id: string): Promise<boolean> => {
    if (!enabled || !user) return false
    const res = await authFetch(`/api/conversations/${id}`, { method: 'DELETE' }, getAccessToken)
    return res.ok
  }

  const loadMessages = async (id: string): Promise<PersistedMessage[]> => {
    if (!enabled || !user) return []
    const res = await authFetch(`/api/conversations/${id}`, {}, getAccessToken)
    if (!res.ok) return []
    const json = await res.json()
    return json.messages ?? []
  }

  return { enabled, signedIn: !!user, list, create, rename, remove, loadMessages }
}
