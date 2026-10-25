import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { ChatApiError, streamChat, type WireMessage } from '../lib/api/chatClient'
import type { ChatMessage, ChatSession, ChatStatus, Citation } from '../types/chat'

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
  | { type: 'session/rename'; id: string; title: string }
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
  | {
      type: 'messages/prepend'
      sessionId: string
      messages: ChatMessage[]
      hasMore: boolean
      nextCursor: string | null
    }
  | { type: 'session/remote'; sessionId: string; remoteId: string }
  | { type: 'sessions/hydrate'; sessions: ChatSession[] }
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

    case 'session/rename':
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.id ? { ...session, title: action.title } : session,
        ),
      }

    case 'session/delete': {
      const sessions = state.sessions.filter((session) => session.id !== action.id)
      if (sessions.length === 0) {
        const session = createSession(Date.now())
        return {
          ...state,
          sessions: [session],
          activeSessionId: session.id,
          status: 'idle',
          error: null,
          failedTurn: null,
        }
      }
      const activeSessionId =
        state.activeSessionId === action.id ? sessions[0].id : state.activeSessionId
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

    case 'messages/prepend':
      return {
        ...state,
        sessions: mapSession(state, action.sessionId, (session) => {
          const existing = new Set(session.messages.map((message) => message.id))
          const older = action.messages.filter((message) => !existing.has(message.id))
          return {
            ...session,
            messages: [...older, ...session.messages],
            hasMoreMessages: action.hasMore,
            oldestMessageCursor: action.nextCursor,
          }
        }),
      }

    case 'session/remote':
      return {
        ...state,
        sessions: mapSession(state, action.sessionId, (session) => ({
          ...session,
          remoteId: action.remoteId,
        })),
      }

    case 'sessions/hydrate': {
      const sessions =
        action.sessions.length > 0 ? action.sessions : [createSession(Date.now())]
      return {
        ...state,
        sessions,
        activeSessionId: sessions[0]?.id ?? state.activeSessionId,
        status: 'idle',
        error: null,
        failedTurn: null,
      }
    }

    case 'chat/error':
      return { ...state, error: action.message }

    default:
      return state
  }
}

export interface PersistedMessageInput {
  role: 'user' | 'assistant'
  content: string
  model?: string | null
  clientMessageId?: string
  citations?: Citation[]
}

export interface ChatPersistence {
  createConversation: (title?: string, clientId?: string) => Promise<{ id: string } | null>
  addMessage: (conversationId: string, message: PersistedMessageInput) => Promise<boolean>
  renameConversation?: (id: string, title: string) => Promise<boolean>
  removeConversation?: (id: string) => Promise<boolean>
}

export interface UseChatOptions {
  model: string | null
  rag?: boolean
  documentIdsBySession?: Record<string, string[]>
  accessToken?: string | null
  persistence?: ChatPersistence | null
  onUnauthorized?: () => void
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
  renameSession: (id: string, title: string) => void
  deleteSession: (id: string) => void
  clearError: () => void
  hydrate: (sessions: ChatSession[]) => void
  reset: () => void
  ensureConversation: (sessionId: string, title?: string) => Promise<string | null>
  prependMessages: (
    sessionId: string,
    messages: ChatMessage[],
    page: { hasMore: boolean; nextCursor: string | null },
  ) => void
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
  const documentIdsBySessionRef = useRef(options.documentIdsBySession)
  const accessTokenRef = useRef(options.accessToken)
  const persistenceRef = useRef(options.persistence)
  const onUnauthorizedRef = useRef(options.onUnauthorized)
  const abortRef = useRef<AbortController | null>(null)
  const remoteIdsRef = useRef(new Map<string, string>())
  const remoteTitlesRef = useRef(new Map<string, string>())
  const ensureRef = useRef(new Map<string, Promise<string | null>>())
  const persistQueueRef = useRef(new Map<string, Promise<void>>())

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
    documentIdsBySessionRef.current = options.documentIdsBySession
  }, [options.documentIdsBySession])
  useEffect(() => {
    accessTokenRef.current = options.accessToken
  }, [options.accessToken])
  useEffect(() => {
    persistenceRef.current = options.persistence
  }, [options.persistence])
  useEffect(() => {
    onUnauthorizedRef.current = options.onUnauthorized
  }, [options.onUnauthorized])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const enqueuePersist = useCallback((sessionId: string, task: () => Promise<void>) => {
    const previous = persistQueueRef.current.get(sessionId) ?? Promise.resolve()
    const next = previous.then(task).catch(() => {})
    persistQueueRef.current.set(sessionId, next)
    void next.finally(() => {
      if (persistQueueRef.current.get(sessionId) === next) {
        persistQueueRef.current.delete(sessionId)
      }
    })
  }, [])

  const ensureRemoteConversation = useCallback(
    (sessionId: string, title?: string): Promise<string | null> => {
      const known =
        remoteIdsRef.current.get(sessionId) ??
        stateRef.current.sessions.find((session) => session.id === sessionId)?.remoteId
      if (known) return Promise.resolve(known)

      const inFlight = ensureRef.current.get(sessionId)
      if (inFlight) return inFlight

      const persistence = persistenceRef.current
      if (!persistence) return Promise.resolve(null)

      const session = stateRef.current.sessions.find((item) => item.id === sessionId)
      const resolvedTitle = title ?? session?.title ?? 'New chat'

      const promise = (async () => {
        const created = await persistence.createConversation(resolvedTitle, sessionId)
        if (!created) return null
        remoteIdsRef.current.set(sessionId, created.id)
        remoteTitlesRef.current.set(sessionId, resolvedTitle)
        dispatch({ type: 'session/remote', sessionId, remoteId: created.id })
        return created.id
      })()

      ensureRef.current.set(sessionId, promise)
      const cleanup = () => {
        if (ensureRef.current.get(sessionId) === promise) ensureRef.current.delete(sessionId)
      }
      void promise.then(cleanup, cleanup)
      return promise
    },
    [],
  )

  const persistMessage = useCallback(
    (sessionId: string, title: string, message: PersistedMessageInput) => {
      const persistence = persistenceRef.current
      if (!persistence) return

      enqueuePersist(sessionId, async () => {
        const remoteId = await ensureRemoteConversation(sessionId, title)
        if (!remoteId) return

        if (
          message.role === 'user' &&
          title !== 'New chat' &&
          persistence.renameConversation &&
          remoteTitlesRef.current.get(sessionId) !== title
        ) {
          const renamed = await persistence.renameConversation(remoteId, title)
          if (renamed) remoteTitlesRef.current.set(sessionId, title)
        }

        await persistence.addMessage(remoteId, message)
      })
    },
    [enqueuePersist, ensureRemoteConversation],
  )

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
      const sessionDocumentIds = documentIdsBySessionRef.current?.[sessionId]
      const documentIds = sessionDocumentIds ?? undefined
      const rag = documentIds ? documentIds.length > 0 : Boolean(ragRef.current)
      const session = stateRef.current.sessions.find((item) => item.id === sessionId)
      const lastUser = [...context].reverse().find((message) => message.role === 'user')
      const conversationTitle =
        session && session.messages.length > 0 ? session.title : titleFrom(lastUser?.content ?? '')
      let assistantText = ''
      let assistantModel: string | null = modelRef.current
      let assistantCitations: Citation[] = []

      void (async () => {
        let conversationId =
          remoteIdsRef.current.get(sessionId) ??
          stateRef.current.sessions.find((item) => item.id === sessionId)?.remoteId ??
          null

        if (documentIds && documentIds.length > 0 && !conversationId) {
          conversationId = await ensureRemoteConversation(sessionId, conversationTitle)
          if (!conversationId) {
            throw new ChatApiError(
              'Could not prepare this conversation for document chat. Please try again.',
              'conversation_failed',
            )
          }
        }

        await streamChat(
          {
            messages: context,
            model: modelRef.current,
            signal: controller.signal,
            rag,
            conversationId,
            accessToken: accessTokenRef.current,
          },
          {
            onStart: ({ model }) => {
              assistantModel = model
              dispatch({ type: 'message/meta', sessionId, id: assistantId, model })
            },
            onCitations: (citations) => {
              assistantCitations = citations as Citation[]
              dispatch({ type: 'message/citations', sessionId, id: assistantId, citations })
            },
            onDelta: (text) => {
              assistantText += text
              dispatch({ type: 'message/delta', sessionId, id: assistantId, text })
            },
            onDone: () => {
              abortRef.current = null
              dispatch({ type: 'message/complete', sessionId, id: assistantId })
              if (assistantText.trim().length > 0) {
                persistMessage(sessionId, conversationTitle, {
                  role: 'assistant',
                  content: assistantText,
                  model: assistantModel,
                  clientMessageId: assistantId,
                  citations: assistantCitations,
                })
              }
            },
          },
        )
      })().catch((error: unknown) => {
        abortRef.current = null

        if (controller.signal.aborted) {
          dispatch({ type: 'message/cancel', sessionId, id: assistantId })
          return
        }

        if (error instanceof ChatApiError && error.status === 401) {
          onUnauthorizedRef.current?.()
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
    [ensureRemoteConversation, persistMessage],
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

      const session = stateRef.current.sessions.find((item) => item.id === sessionId)
      const conversationTitle =
        session && session.messages.length > 0 ? session.title : titleFrom(trimmed)

      dispatch({ type: 'message/send', sessionId, user, assistantId, now })
      persistMessage(sessionId, conversationTitle, {
        role: 'user',
        content: trimmed,
        clientMessageId: user.id,
      })
      runCompletion(sessionId, assistantId, context, user.id)
    },
    [completedHistory, persistMessage, runCompletion],
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

  const renameSession = useCallback((id: string, title: string) => {
    dispatch({ type: 'session/rename', id, title })
  }, [])

  const deleteSession = useCallback((id: string) => {
    if (stateRef.current.activeSessionId === id) {
      abortRef.current?.abort()
      abortRef.current = null
    }

    const remoteId =
      remoteIdsRef.current.get(id) ?? stateRef.current.sessions.find((session) => session.id === id)?.remoteId
    remoteIdsRef.current.delete(id)
    remoteTitlesRef.current.delete(id)
    ensureRef.current.delete(id)
    persistQueueRef.current.delete(id)

    if (remoteId) {
      void persistenceRef.current?.removeConversation?.(remoteId)
    }

    dispatch({ type: 'session/delete', id })
  }, [])

  const clearError = useCallback(() => {
    dispatch({ type: 'chat/error', message: null })
  }, [])

  const hydrate = useCallback((sessions: ChatSession[]) => {
    remoteIdsRef.current.clear()
    remoteTitlesRef.current.clear()
    ensureRef.current.clear()
    persistQueueRef.current.clear()
    for (const session of sessions) {
      remoteIdsRef.current.set(session.id, session.remoteId ?? session.id)
      remoteTitlesRef.current.set(session.id, session.title)
    }
    dispatch({ type: 'sessions/hydrate', sessions })
  }, [])

  const reset = useCallback(() => {
    remoteIdsRef.current.clear()
    remoteTitlesRef.current.clear()
    ensureRef.current.clear()
    persistQueueRef.current.clear()
    dispatch({ type: 'sessions/hydrate', sessions: [] })
  }, [])

  const prependMessages = useCallback(
    (
      sessionId: string,
      messages: ChatMessage[],
      page: { hasMore: boolean; nextCursor: string | null },
    ) => {
      dispatch({
        type: 'messages/prepend',
        sessionId,
        messages,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      })
    },
    [],
  )

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
    renameSession,
    deleteSession,
    clearError,
    hydrate,
    reset,
    ensureConversation: ensureRemoteConversation,
    prependMessages,
  }
}
