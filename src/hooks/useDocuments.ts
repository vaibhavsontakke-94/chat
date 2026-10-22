import { useCallback, useMemo, useState } from 'react'

export type DocumentStatus = 'queued' | 'rejected'

export interface UploadedDocument {
  id: string
  name: string
  size: number
  mimeType: string
  uploadedAt: number
  status: DocumentStatus
  note?: string
}

export const ACCEPTED_EXTENSIONS = ['.pdf', '.txt', '.md', '.docx', '.doc', '.csv', '.json', '.html', '.htm']

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

export function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension))
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function createId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

export interface UseDocumentsResult {
  documents: UploadedDocument[]
  addFiles: (files: File[]) => UploadedDocument[]
  remove: (id: string) => void
  clear: () => void
}

export function useDocuments(): UseDocumentsResult {
  const [documents, setDocuments] = useState<UploadedDocument[]>([])

  const addFiles = useCallback((files: File[]) => {
    const now = Date.now()
    const added: UploadedDocument[] = files.map((file) => {
      const rejected = !isAcceptedFile(file)
      const tooLarge = file.size > MAX_FILE_SIZE_BYTES

      return {
        id: createId(),
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        uploadedAt: now,
        status: rejected || tooLarge ? 'rejected' : 'queued',
        note: rejected
          ? 'Unsupported file type.'
          : tooLarge
            ? `Larger than ${formatFileSize(MAX_FILE_SIZE_BYTES)}.`
            : undefined,
      }
    })

    setDocuments((current) => [...added, ...current])
    return added
  }, [])

  const remove = useCallback((id: string) => {
    setDocuments((current) => current.filter((document) => document.id !== id))
  }, [])

  const clear = useCallback(() => {
    setDocuments([])
  }, [])

  return useMemo(
    () => ({ documents, addFiles, remove, clear }),
    [documents, addFiles, remove, clear],
  )
}
