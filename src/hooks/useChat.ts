import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { ChatApiError, streamChat, type WireMessage } from '../lib/api/chatClient'
import type { ChatMessage, ChatSession, ChatStatus } from '../types/chat'

const MAX_TITLE_LENGTH = 48

interface ChatState {
  sessions: ChatSession[]
  activeSessionId: string
  status: ChatStatus
  error: string | null
  /** The assistant turn that failed, so it can be retried in place. */
  failedTurn: { sessionId: string; assistantId: string; userMessageId: string } | null
}

type Action =
  | { type: 'session/new'; session: ChatSession }
  | { type: 'session/select'; id: string }
  | { type: 'session/delete'; id: string }
  | {
      type: 'message/send'
      sessionId: string
      user: ChatMessage
      assistantId: string
      now: number
    }
  | { type: 'message/delta'; sessionId: string; id: string; text: string }
  | { type: 'message/meta'; sessionId: string; id: string; model: string }
  | { type: 'message/citations'; sessionId: string; id: string; citations: any[] }
  | { type: 'message/complete'; sessionId: string; id: string }
  | { type: 'message/fail'; sessionId: string; id: string; error: string; userMessageId: string }
  | { type: 'message/cancel'; sessionId: string; id: string }
  | { type: 'message/retry'; sessionId: string; assistantId: string; now: number }
  | { type: 'message/remove'; sessionId: string; id: string }
  | { type: 'chat/error'; message: string | null }

function createId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `${prefix}_${random}`
}

function createSession(now: number): ChatSession {
  return {
    id: createId('sess'),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
}

function titleFrom(content: string): string {
  const singleLine = content.replace(/\s+/g, ' ').trim()
  if (singleLine.length === 0) return 'New chat'
  return singleLine.length > MAX_TITLE_LENGTH
    ? `${singleLine.slice(0, MAX_TITLE_LENGTH - 1)}…`
    : singleLine
}

function mapSession(
  state: ChatState,
  sessionId: string,
  update: (session: ChatSession) => ChatSession,
): ChatSession[] {
  return state.sessions.map((session) => (session.id === sessionId ? update(session) : session))
}

function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case 'session/new':
      return {
        ...state,
        sessions: [action.session, ...state.sessions],
        activeSessionId: action.session.id,
        status: 'idle',
        error: null,
        failedTurn: null,
      }

    case 'session/select':
      return {
        ...state,
        activeSessionId: action.id,
        status: 'idle',
        error: null,
        failedTurn: null,
      }

    case 'session/delete': {
      const sessions = state.sessions.filter((session) => session.id !== action.id)
      const activeSessionId =
        state.activeSessionId === action.id
          ? (sessions[0]?.id ?? createSession(Date.now()).id)
          : state.activeSessionId
      return { ...state, sessions, activeSessionId, failedTurn: null }
    }

    case 'message/send': {
      const assistant: ChatMessage = {
        id: action.assistantId,
        role: 'assistant',
        content: '',
        createdAt: action.now,
        status: 'streaming',
      }

      return {
        ...state,
        status: 'streaming',
        error: null,
        failedTurn: null,
        sessions: mapSession(state, action.sessionId, (session) => ({
          ...session,
          title:
            session.messages.length === 0 && session.title === 'New chat'
              ? titleFrom(action.user.content)
              : session.title,
          updatedAt: action.now,
          messages: [...session.messages, action.user, assistant],
        })),
      }
    }

    case 'message/delta':
      return {
        ...state,
        sessions: mapSession(state, action.sessionId, (session) => ({
          ...session,
          messages: session.messages.map((message) =>
            message.id === action.id ? { ...message, content: message.content + action.text } : message,
          ),
        })),
      }

    case 'message/meta':
      return {
        ...state,
        sessions: mapSession(state, action.sessionId, (session) => ({
          ...session,
          messages: session.messages.map((message) =>
            message.id === action.id ? { ...message, model: action.model } : message,
          ),
        })),
      }

    case 'message/citations':
      return {
        ...state,
        sessions: mapSession(state, action.sessionId, (session) => ({
          ...session,
          messages: session.messages.map((message) =>
            message.id === action.id ? { ...message, citations: action.citations } : message,
          ),
        })),
      }

    case 'message/complete':
      return {
        ...state,
        status: 'idle',
        failedTurn: null,
        sessions: mapSession(state, action.sessionId, (session) => ({
          ...session,
          messages: session.messages.map((message) =>
            message.id === action.id
              ? { ...message, status: 'complete' as const, error: undefined }
              : message,
          ),
        })),
      }

    case 'message/fail':
      return {
        ...state,
        status: 'idle',
        error: action.error,
        failedTurn: {
          sessionId: action.sessionId,
          assistantId: action.id,
          userMessageId: action.userMessageId,
        },
        sessions: mapSession(state, action.sessionId, (session) => ({
          ...session,
          messages: session.messages.map((message) =>
            message.id === action.id
              ? { ...message, status: 'error' as const, error: action.error }
              : message,
          ),
        })),
      }

    case 'message/cancel':
      return {
        ...state,
        status: 'idle',
        error: null,
        sessions: mapSession(state, action.sessionId, (session) => ({
          ...session,
          messages: session.messages.map((message) =>
            message.id === action.id
              ? { ...message, status: 'cancelled' as const, error: undefined }
              : message,
          ),
        })),
      }

    case 'message/retry':
      return {
        ...state,
        status: 'streaming',
        error: null,
        failedTurn: null,
        sessions: mapSession(state, action.sessionId, (session) => ({
          ...session,
          messages: session.messages.map((message) =>
            message.id === action.assistantId
              ? {
                  ...message,
                  content: '',
                  status: 'streaming' as const,
                  error: undefined,
                  retried: true,
                }
              : message,
          ),
        })),
      }

    case 'message/remove':
      return {
        ...state,
        sessions: mapSession(state, action.sessionId, (session) => ({
          ...session,
          messages: session.messages.filter((message) => message.id !== action.id),
        })),
      }

    case 'chat/error':
      return { ...state, error: action.message }

    default:
      return state
  }
}

export interface UseChatOptions {
  model: string | null
  rag?: boolean
  documentId?: string | null
}

export interface UseChatResult {
  sessions: ChatSession[]
  activeSession: ChatSession
  activeSessionId: string
  status: ChatStatus
  error: string | null
  canRetry: boolean
  sendMessage: (content: string) => void
  cancel: () => void
  retry: () => void
  newChat: () => void
  selectSession: (id: string) => void
  deleteSession: (id: string) => void
  clearError: () => void
}

export function useChat(options: UseChatOptions): UseChatResult {
  const [state, dispatch] = useReducer(reducer, undefined, (): ChatState => {
    const now = Date.now()
    const session = createSession(now)
    return {
      sessions: [session],
      activeSessionId: session.id,
      status: 'idle',
      error: null,
      failedTurn: null,
    }
  })

  const stateRef = useRef(state)
  const modelRef = useRef(options.model)
  const ragRef = useRef(options.rag)
  const docRef = useRef(options.documentId)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    stateRef.current = state
  })

  useEffect(() => {
    modelRef.current = options.model
  }, [options.model])
  useEffect(() => {
    ragRef.current = options.rag
  }, [options.rag])
  useEffect(() => {
    docRef.current = options.documentId
  }, [options.documentId])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  /** Completed history for a session, oldest first. */
  const completedHistory = useCallback((sessionId: string) => {
    const session = stateRef.current.sessions.find((item) => item.id === sessionId)
    if (!session) return []

    return session.messages
      .filter((message) => message.status === 'complete')
      .map((message) => ({ role: message.role, content: message.content }))
  }, [])

  /** History up to and including a specific user message. */
  const historyThrough = useCallback((sessionId: string, userMessageId: string) => {
    const session = stateRef.current.sessions.find((item) => item.id === sessionId)
    if (!session) return null

    const userIndex = session.messages.findIndex((message) => message.id === userMessageId)
    if (userIndex === -1) return null

    return session.messages
      .slice(0, userIndex + 1)
      .filter((message) => message.status === 'complete')
      .map((message) => ({ role: message.role, content: message.content }))
  }, [])

  const runCompletion = useCallback(
    (sessionId: string, assistantId: string, context: WireMessage[], userMessageId: string) => {
      if (context.length === 0) return

      const controller = new AbortController()
      abortRef.current = controller

      void streamChat(
        { messages: context, model: modelRef.current, signal: controller.signal, rag: ragRef.current, documentId: docRef.current },
        {
          onStart: ({ model }) => {
            dispatch({ type: 'message/meta', sessionId, id: assistantId, model })
          },
          onCitations: (citations) => {
            dispatch({ type: 'message/citations', sessionId, id: assistantId, citations })
          },
          onDelta: (text) => {
            dispatch({ type: 'message/delta', sessionId, id: assistantId, text })
          },
          onDone: () => {
            abortRef.current = null
            dispatch({ type: 'message/complete', sessionId, id: assistantId })
          },
        },
      )
        .catch((error: unknown) => {
          abortRef.current = null

          if (controller.signal.aborted) {
            dispatch({ type: 'message/cancel', sessionId, id: assistantId })
            return
          }

          const message =
            error instanceof ChatApiError
              ? error.message
              : 'Something went wrong while contacting the model.'

          dispatch({
            type: 'message/fail',
            sessionId,
            id: assistantId,
            error: message,
            userMessageId,
          })
        })
    },
    [],
  )

  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim()
      if (trimmed.length === 0) return
      if (stateRef.current.status === 'streaming') return

      const sessionId = stateRef.current.activeSessionId
      const now = Date.now()
      const user: ChatMessage = {
        id: createId('msg'),
        role: 'user',
        content: trimmed,
        createdAt: now,
        status: 'complete',
      }
      const assistantId = createId('msg')

      // The context is built from the last committed state plus the new message,
      // because the dispatched turn has not been committed yet.
      const context: WireMessage[] = [
        ...completedHistory(sessionId),
        { role: 'user', content: trimmed },
      ]

      dispatch({ type: 'message/send', sessionId, user, assistantId, now })
      runCompletion(sessionId, assistantId, context, user.id)
    },
    [completedHistory, runCompletion],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const retry = useCallback(() => {
    const failed = stateRef.current.failedTurn
    if (!failed) return
    if (stateRef.current.status === 'streaming') return

    const context = historyThrough(failed.sessionId, failed.userMessageId)
    if (!context || context.length === 0) return

    dispatch({ type: 'message/retry', sessionId: failed.sessionId, assistantId: failed.assistantId, now: Date.now() })
    runCompletion(failed.sessionId, failed.assistantId, context, failed.userMessageId)
  }, [historyThrough, runCompletion])

  const newChat = useCallback(() => {
    if (stateRef.current.status === 'streaming') abortRef.current?.abort()
    dispatch({ type: 'session/new', session: createSession(Date.now()) })
  }, [])

  const selectSession = useCallback((id: string) => {
    dispatch({ type: 'session/select', id })
  }, [])

  const deleteSession = useCallback((id: string) => {
    dispatch({ type: 'session/delete', id })
  }, [])

  const clearError = useCallback(() => {
    dispatch({ type: 'chat/error', message: null })
  }, [])

  const activeSession = useMemo(
    () => state.sessions.find((session) => session.id === state.activeSessionId) ?? state.sessions[0],
    [state.sessions, state.activeSessionId],
  )

  return {
    sessions: state.sessions,
    activeSession,
    activeSessionId: state.activeSessionId,
    status: state.status,
    error: state.error,
    canRetry: state.failedTurn !== null,
    sendMessage,
    cancel,
    retry,
    newChat,
    selectSession,
    deleteSession,
    clearError,
  }
}
