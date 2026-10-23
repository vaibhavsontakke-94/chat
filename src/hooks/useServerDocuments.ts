import { useCallback, useMemo } from 'react'
import { useAuth } from '../lib/auth/AuthProvider'

export interface ServerDocument {
  id: string
  filename: string
  mime_type: string | null
  size_bytes: number | null
  page_count: number | null
  status: 'pending' | 'processing' | 'ready' | 'error'
  conversation_id?: string | null
  created_at: string
  updated_at: string
}

export interface UploadOptions {
  conversationId?: string | null
  onProgress?: (percent: number) => void
}

export interface UploadResult {
  ok: boolean
  message?: string
  documentId?: string
  duplicate?: boolean
  status?: string
}

export function useServerDocuments() {
  const { enabled, user, getAccessToken } = useAuth()

  const authFetch = useCallback(
    async (input: RequestInfo, init: RequestInit = {}) => {
      const token = getAccessToken()
      const headers = new Headers(init.headers || {})
      if (!(init.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json')
      }
      if (token) headers.set('Authorization', `Bearer ${token}`)
      return fetch(input, { ...init, headers })
    },
    [getAccessToken],
  )

  const list = useCallback(async (): Promise<ServerDocument[]> => {
    if (!enabled || !user) return []
    try {
      const res = await authFetch('/api/documents')
      if (!res.ok) return []
      const json = await res.json()
      return json.documents ?? []
    } catch {
      return []
    }
  }, [authFetch, enabled, user])

  const upload = useCallback(
    async (file: File, options: UploadOptions = {}): Promise<UploadResult> => {
      if (!enabled || !user) {
        return { ok: false, message: 'Your private session is not ready. Reload and try again.' }
      }

      const token = getAccessToken()
      const fd = new FormData()
      fd.append('file', file)
      if (options.conversationId) fd.append('conversationId', options.conversationId)

      return new Promise<UploadResult>((resolve) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/documents/upload')
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable || !options.onProgress) return
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100))
          options.onProgress(percent)
        }

        xhr.onerror = () => resolve({ ok: false, message: 'Could not reach the server.' })
        xhr.onabort = () => resolve({ ok: false, message: 'Upload cancelled.' })
        xhr.onload = () => {
          let json: any = {}
          try {
            json = xhr.responseText ? JSON.parse(xhr.responseText) : {}
          } catch {
            json = {}
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            resolve({
              ok: false,
              message: json?.error?.message || `Upload failed (HTTP ${xhr.status}).`,
            })
            return
          }
          options.onProgress?.(100)
          resolve({
            ok: true,
            documentId: json.documentId,
            duplicate: json.duplicate === true,
            status: json.status,
          })
        }

        xhr.send(fd)
      })
    },
    [enabled, getAccessToken, user],
  )

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      if (!enabled || !user) return false
      try {
        const res = await authFetch(`/api/documents/${id}`, { method: 'DELETE' })
        return res.ok
      } catch {
        return false
      }
    },
    [authFetch, enabled, user],
  )

  return useMemo(
    () => ({ enabled, signedIn: !!user, list, upload, remove }),
    [enabled, list, remove, upload, user],
  )
}
