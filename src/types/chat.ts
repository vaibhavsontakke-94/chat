export interface Citation {
  filename: string
  page_number: number | null
  chunk_id: string
  similarity: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  status: 'complete' | 'streaming' | 'error' | 'cancelled'
  error?: string
  model?: string
  retried?: boolean
  citations?: Citation[]
}
