import { useAuth } from '../lib/auth/AuthProvider'

export interface ServerDocument {
  id: string
  filename: string
  mime_type: string | null
  size_bytes: number | null
  page_count: number | null
  status: 'pending' | 'processing' | 'ready' | 'error'
  created_at: string
  updated_at: string
}

async function authFetch(input: RequestInfo, init: RequestInit = {}, getToken: () => string | null) {
  const token = getToken()
  const headers = new Headers(init.headers || {})
  if (!(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}

export function useServerDocuments() {
  const { enabled, user, getAccessToken } = useAuth()

  const list = async (): Promise<ServerDocument[]> => {
    if (!enabled || !user) return []
    const res = await authFetch('/api/documents', {}, getAccessToken)
    if (!res.ok) return []
    const json = await res.json()
    return json.documents ?? []
  }

  const upload = async (file: File): Promise<{ ok: boolean; message?: string; documentId?: string }> => {
    if (!enabled || !user) return { ok: false, message: 'Sign in required' }
    const fd = new FormData()
    fd.append('file', file)
    const token = getAccessToken()
    const headers = new Headers()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const res = await fetch('/api/documents/upload', { method: 'POST', headers, body: fd })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, message: json?.error?.message || 'Upload failed' }
    return { ok: true, documentId: json.documentId }
  }

  const remove = async (id: string): Promise<boolean> => {
    if (!enabled || !user) return false
    const res = await authFetch(`/api/documents/${id}`, { method: 'DELETE' }, getAccessToken)
    return res.ok
  }

  return { enabled, signedIn: !!user, list, upload, remove }
}
