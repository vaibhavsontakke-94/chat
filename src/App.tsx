import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { AuthSplash } from './components/auth/AuthSplash'
import { usePathname } from './lib/router'
import { AppShell } from './components/layout/AppShell'
import { ChatHeader } from './components/layout/ChatHeader'
import { Sidebar, type AppView } from './components/layout/Sidebar'
import { ChatEmptyState } from './components/chat/ChatEmptyState'
import { ChatInput, type AttachedFile } from './components/chat/ChatInput'
import { MessageList } from './components/chat/MessageList'
import { SettingsView } from './components/views/SettingsView'
import { Button } from './components/ui/Button'
import { IconButton } from './components/ui/IconButton'
import { useChat } from './hooks/useChat'
import {
  MAX_FILE_SIZE_BYTES,
  formatFileSize,
  useDocuments,
} from './hooks/useDocuments'
import { useMediaQuery, MOBILE_QUERY } from './hooks/useMediaQuery'
import { usePreferences } from './hooks/usePreferences'
import { fetchModels, fetchProviderStatus } from './lib/api/chatClient'
import type { ChatMessage, ChatSession, ModelOption, ProviderInfo } from './types/chat'
import { useAuth } from './lib/auth/AuthProvider'
import { useConversations, type PersistedMessage } from './hooks/useConversations'
import { useServerDocuments, type ServerDocument } from './hooks/useServerDocuments'

const MAX_MESSAGE_CHARS = 8_000

function toChatMessage(message: PersistedMessage): ChatMessage | null {
  if (message.role === 'system') return null
  return {
    id: message.id,
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: message.content,
    createdAt: Date.parse(message.created_at) || Date.now(),
    status: 'complete',
    model: message.model ?? undefined,
    citations: message.metadata?.citations,
  }
}

type AttachmentSource = 'server' | 'local'

interface AttachmentRef {
  id: string
  source: AttachmentSource
}

const EMPTY_ATTACHMENT_REFS: AttachmentRef[] = []

function ChatApp({ initialView = 'chat' }: { initialView?: AppView }) {
  const { sendOnEnter, showTimestamps } = usePreferences()
  const auth = useAuth()
  const conversations = useConversations()

  const isMobile = useMediaQuery(MOBILE_QUERY)
  const [view, setView] = useState<AppView>(initialView)
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true)
  const [composer, setComposer] = useState('')
  const [provider, setProvider] = useState<ProviderInfo>({
    status: 'unknown',
    provider: 'unknown',
    model: '',
  })
  const [models, setModels] = useState<ModelOption[]>([])
  const [activeModel, setActiveModel] = useState<string | null>(null)

  const documents = useDocuments()
  const serverDocs = useServerDocuments()
  const [serverDocList, setServerDocList] = useState<ServerDocument[]>([])
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([])
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [loadingOlder, setLoadingOlder] = useState<Record<string, boolean>>({})
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [canRetryUpload, setCanRetryUpload] = useState(false)
  const [attachmentsBySession, setAttachmentsBySession] = useState<
    Record<string, AttachmentRef[]>
  >({})
  const seededUserRef = useRef<string | null>(null)
  const uploadingNamesRef = useRef<Set<string>>(new Set())
  const lastFailedUploadRef = useRef<{ file: File; sessionId: string } | null>(null)

  const visibleServerDocs = useMemo(
    () => (auth.user ? serverDocList : []),
    [auth.user, serverDocList],
  )
  const readyDocumentIdsBySession = useMemo(() => {
    const readyIds = new Set(
      visibleServerDocs
        .filter((document) => document.status === 'ready')
        .map((document) => document.id),
    )
    const map: Record<string, string[]> = {}

    for (const [sessionId, refs] of Object.entries(attachmentsBySession)) {
      map[sessionId] = refs
        .filter((ref) => ref.source === 'server' && readyIds.has(ref.id))
        .map((ref) => ref.id)
    }

    return map
  }, [attachmentsBySession, visibleServerDocs])
  const chat = useChat({
    model: activeModel,
    documentIdsBySession: readyDocumentIdsBySession,
    accessToken: auth.getAccessToken(),
    persistence: auth.user
      ? {
          createConversation: conversations.create,
          addMessage: conversations.addMessage,
          removeConversation: conversations.remove,
        }
      : null,
    onUnauthorized: () => {
      setUploadError('Your private session expired. Reload the page to continue.')
    },
  })
  const activeSessionIdRef = useRef(chat.activeSessionId)
  const currentAttachments = auth.user
    ? (attachmentsBySession[chat.activeSessionId] ?? EMPTY_ATTACHMENT_REFS)
    : EMPTY_ATTACHMENT_REFS

  useEffect(() => {
    activeSessionIdRef.current = chat.activeSessionId
  }, [chat.activeSessionId])

  const syncedUserRef = useRef<string | null>(null)
  const syncInFlightRef = useRef<string | null>(null)
  const hydrateSessions = chat.hydrate
  const resetSessions = chat.reset
  const listConversations = conversations.list
  const loadConversationMessages = conversations.loadMessages

  useEffect(() => {
    if (auth.loading) return

    if (!auth.user) {
      syncInFlightRef.current = null
      if (syncedUserRef.current !== null) {
        syncedUserRef.current = null
        resetSessions()
      }
      return
    }

    const userId = auth.user.id
    if (syncedUserRef.current === userId || syncInFlightRef.current === userId) return
    syncInFlightRef.current = userId

    let cancelled = false
    void (async () => {
      const list = await listConversations()
        const sessions = await Promise.all(
        list.map(async (conversation): Promise<ChatSession> => {
          const page = await loadConversationMessages(conversation.id)
          const messages = page.messages
            .map(toChatMessage)
            .filter((message): message is ChatMessage => message !== null)
          return {
            id: conversation.id,
            remoteId: conversation.id,
            title: conversation.title || 'New chat',
            createdAt: Date.parse(conversation.created_at) || Date.now(),
            updatedAt: Date.parse(conversation.updated_at) || Date.now(),
            messages,
            hasMoreMessages: page.hasMore,
            oldestMessageCursor: page.nextCursor,
          }
        }),
      )
      if (syncInFlightRef.current === userId) syncInFlightRef.current = null
      if (!cancelled) {
        syncedUserRef.current = userId
        hydrateSessions(sessions)
      }
    })()

    return () => {
      cancelled = true
      if (syncInFlightRef.current === userId) syncInFlightRef.current = null
    }
  }, [
    auth.loading,
    auth.user,
    hydrateSessions,
    listConversations,
    loadConversationMessages,
    resetSessions,
  ])

  const isSidebarOpen = isMobile ? isMobileSidebarOpen : isDesktopSidebarOpen

  const setSidebarOpen = useCallback(
    (open: boolean) => {
      if (isMobile) setIsMobileSidebarOpen(open)
      else setIsDesktopSidebarOpen(open)
    },
    [isMobile],
  )

  const toggleSidebar = useCallback(() => {
    if (isMobile) setIsMobileSidebarOpen((current) => !current)
    else setIsDesktopSidebarOpen((current) => !current)
  }, [isMobile])

  useEffect(() => {
    const controller = new AbortController()

    const load = async () => {
      try {
        const status = await fetchProviderStatus(controller.signal)
        setProvider(status)

        if (status.status !== 'ready') {
          setModels([])
          setActiveModel(null)
        } else {
          const response = await fetchModels(controller.signal)
          setModels(response.models)
          setActiveModel(response.active)
        }
      } catch (error) {
        if (controller.signal.aborted) return
        setProvider({
          status: 'error',
          provider: 'unknown',
          model: '',
          message: 'Could not reach the server.',
        })
        setModels([])
        setActiveModel(null)
        void error
      }
    }

    void load()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!auth.user) return

    const userId = auth.user.id
    let cancelled = false
    serverDocs
      .list()
      .then((next) => {
        if (cancelled) return
        setServerDocList(next)

        if (seededUserRef.current === userId) return
        seededUserRef.current = userId
        const sessionId = activeSessionIdRef.current
        setAttachmentsBySession((current) => ({
          ...current,
          [sessionId]: next.map((document) => ({
            id: document.id,
            source: 'server' as const,
          })),
        }))
      })
      .catch(() => {
        if (!cancelled) setServerDocList([])
      })

    return () => {
      cancelled = true
    }
  }, [auth.user, serverDocs])

  const handleSend = useCallback(() => {
    const content = composer.trim()
    if (content.length === 0) return
    chat.sendMessage(content)
    setComposer('')
  }, [chat, composer])

  const refreshServerDocs = useCallback(async () => {
    const next = await serverDocs.list().catch(() => [] as ServerDocument[])
    setServerDocList(next)
    return next
  }, [serverDocs])

  const handleServerFiles = useCallback(
    async (files: File[], sessionId: string) => {
      setUploadError(null)
      setCanRetryUpload(false)
      lastFailedUploadRef.current = null

      if (!auth.user) {
        setUploadError(
          auth.error ??
            (auth.enabled
              ? 'Your private session is still starting. Try again in a moment.'
              : 'Authentication is not configured on this deployment.'),
        )
        return
      }
      if (files.length === 0) return

      const pdfFiles = files.filter((file) => file.name.toLowerCase().endsWith('.pdf'))
      if (pdfFiles.length === 0) {
        setUploadError('Only PDF documents are supported.')
        return
      }

      const messages: string[] = []
      if (pdfFiles.length !== files.length) {
        messages.push('Only PDF documents are supported. Other files were skipped.')
      }

      for (const file of pdfFiles) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          messages.push(`${file.name} is larger than ${formatFileSize(MAX_FILE_SIZE_BYTES)}.`)
          continue
        }
        if (uploadingNamesRef.current.has(file.name)) {
          messages.push(`${file.name} is already uploading.`)
          continue
        }

        uploadingNamesRef.current.add(file.name)
        setUploadingFiles(Array.from(uploadingNamesRef.current))
        setUploadProgress((current) => ({ ...current, [file.name]: 0 }))

        try {
          const conversationId =
            chat.sessions.find((session) => session.id === sessionId)?.remoteId ?? null
          const result = await serverDocs.upload(file, {
            conversationId,
            onProgress: (percent) =>
              setUploadProgress((current) => ({ ...current, [file.name]: percent })),
          })
          if (!result.ok) {
            messages.push(result.message || `Could not upload ${file.name}.`)
            lastFailedUploadRef.current = { file, sessionId }
            setCanRetryUpload(true)
            continue
          }

          await refreshServerDocs()

          if (result.documentId) {
            setAttachmentsBySession((current) => {
              const refs = current[sessionId] ?? []
              if (refs.some((ref) => ref.id === result.documentId)) return current
              return {
                ...current,
                [sessionId]: [
                  ...refs,
                  { id: result.documentId as string, source: 'server' },
                ],
              }
            })
          }
        } catch {
          messages.push(`Could not upload ${file.name}.`)
          lastFailedUploadRef.current = { file, sessionId }
          setCanRetryUpload(true)
        } finally {
          uploadingNamesRef.current.delete(file.name)
          setUploadingFiles(Array.from(uploadingNamesRef.current))
          setUploadProgress((current) => {
            if (!(file.name in current)) return current
            const next = { ...current }
            delete next[file.name]
            return next
          })
        }
      }

      await refreshServerDocs()
      if (messages.length > 0) setUploadError(messages.join(' '))
    },
    [auth.enabled, auth.error, auth.user, chat.sessions, refreshServerDocs, serverDocs],
  )

  const handleAttachFiles = useCallback(
    (files: File[]) => {
      const sessionId = activeSessionIdRef.current
      if (!auth.user) {
        setUploadError(
          auth.error ??
            (auth.enabled
              ? 'Your private session is still starting. Try again in a moment.'
              : 'Authentication is not configured on this deployment.'),
        )
        return
      }
      void handleServerFiles(files, sessionId)
    },
    [auth.enabled, auth.error, auth.user, handleServerFiles],
  )

  const handleRetryUpload = useCallback(() => {
    const failed = lastFailedUploadRef.current
    if (!failed) return
    void handleServerFiles([failed.file], failed.sessionId)
  }, [handleServerFiles])

  const handleLoadMoreMessages = useCallback(async () => {
    const session = chat.activeSession
    if (!session.remoteId || !session.hasMoreMessages) return
    if (loadingOlder[session.id]) return

    setLoadingOlder((current) => ({ ...current, [session.id]: true }))
    try {
      const page = await conversations.loadMessages(session.remoteId, {
        before: session.oldestMessageCursor,
      })
      const older = page.messages
        .map(toChatMessage)
        .filter((message): message is ChatMessage => message !== null)
      if (older.length > 0) {
        chat.prependMessages(session.id, older, {
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
        })
      } else if (!page.hasMore) {
        chat.prependMessages(session.id, [], { hasMore: false, nextCursor: null })
      }
    } finally {
      setLoadingOlder((current) => ({ ...current, [session.id]: false }))
    }
  }, [chat, conversations, loadingOlder])

  const dismissUploadError = useCallback(() => {
    setUploadError(null)
    setCanRetryUpload(false)
    lastFailedUploadRef.current = null
  }, [])

  const handleAttachExisting = useCallback((id: string) => {
    const sessionId = activeSessionIdRef.current
    setAttachmentsBySession((current) => {
      const refs = current[sessionId] ?? []
      if (refs.some((ref) => ref.id === id && ref.source === 'server')) return current
      return {
        ...current,
        [sessionId]: [...refs, { id, source: 'server' }],
      }
    })
  }, [])

  const handleRemoveAttached = useCallback(
    (id: string) => {
      const sessionId = activeSessionIdRef.current
      setAttachmentsBySession((current) => ({
        ...current,
        [sessionId]: (current[sessionId] ?? []).filter((ref) => ref.id !== id),
      }))
      documents.remove(id)
    },
    [documents],
  )

  const handleDeleteSession = useCallback(
    (id: string) => {
      chat.deleteSession(id)
      setAttachmentsBySession((current) => {
        if (!(id in current)) return current
        const next = { ...current }
        delete next[id]
        return next
      })
    },
    [chat],
  )

  const handleSelectSession = useCallback(
    (id: string) => {
      chat.selectSession(id)
      setView('chat')
      if (isMobile) setIsMobileSidebarOpen(false)
    },
    [chat, isMobile],
  )

  const handleNewChat = useCallback(() => {
    chat.newChat()
    setView('chat')
    if (isMobile) setIsMobileSidebarOpen(false)
  }, [chat, isMobile])

  const handleViewChange = useCallback(
    (next: AppView) => {
      setView(next)
      if (isMobile) setIsMobileSidebarOpen(false)
    },
    [isMobile],
  )

  const attachedFiles = useMemo(
    () =>
      currentAttachments.flatMap((ref): AttachedFile[] => {
        if (ref.source === 'server') {
          const document = visibleServerDocs.find((item) => item.id === ref.id)
          return document
            ? [{ id: document.id, name: document.filename, status: document.status }]
            : []
        }

        const document = documents.documents.find((item) => item.id === ref.id)
        return document ? [{ id: document.id, name: document.name, status: document.status }] : []
      }),
    [currentAttachments, visibleServerDocs, documents.documents],
  )

  const availableFiles = useMemo(() => {
    const attachedIds = new Set(
      currentAttachments
        .filter((ref) => ref.source === 'server')
        .map((ref) => ref.id),
    )
    return visibleServerDocs
      .filter((document) => !attachedIds.has(document.id))
      .map((document) => ({
        id: document.id,
        name: document.filename,
        status: document.status,
      }))
  }, [currentAttachments, visibleServerDocs])

  const isEmpty = chat.activeSession.messages.length === 0
  const providerReady = provider.status === 'ready'

  const composerDisabledReason = useMemo(() => {
    if (provider.status === 'unconfigured') {
      return 'No AI provider is configured. Add GROQ_API_KEY to .env and restart the server.'
    }
    if (provider.status === 'error') {
      return 'The chat server is unreachable. Make sure it is running on the configured port.'
    }
    return undefined
  }, [provider.status])

  const sidebar = (
    <Sidebar
      sessions={chat.sessions}
      activeSessionId={chat.activeSessionId}
      view={view}
      onViewChange={handleViewChange}
      onSelectSession={handleSelectSession}
      onDeleteSession={handleDeleteSession}
      onNewChat={handleNewChat}
      provider={provider}
      isOpen={isSidebarOpen}
      onClose={() => setSidebarOpen(false)}
    />
  )

  const header = (
    <ChatHeader
      isSidebarOpen={isSidebarOpen}
      onOpenSidebar={toggleSidebar}
      onNewChat={handleNewChat}
    />
  )

  return (
    <AppShell
      sidebar={sidebar}
      header={header}
      isSidebarOpen={isSidebarOpen}
      onSidebarOpenChange={setSidebarOpen}
    >
      {view === 'chat' ? (
        <>
          {auth.error ? (
            <div className="mx-4 mt-3 mb-1 flex w-full max-w-3xl shrink-0 items-start gap-2.5 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 sm:mx-6">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
              <p className="flex-1 text-xs leading-relaxed text-danger">{auth.error}</p>
            </div>
          ) : null}

          {conversations.error ? (
            <div className="mx-4 mt-3 mb-1 flex w-full max-w-3xl shrink-0 items-start gap-2.5 rounded-xl border border-warning/25 bg-warning-soft px-3.5 py-2.5 sm:mx-6">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="flex-1 text-xs leading-relaxed text-warning">
                {conversations.error}
              </p>
              <IconButton
                label="Dismiss history warning"
                size="sm"
                icon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={conversations.clearError}
              />
            </div>
          ) : null}

          {isEmpty ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ChatEmptyState />
            </div>
          ) : (
            <MessageList
              messages={chat.activeSession.messages}
              showTimestamps={showTimestamps}
              onRetry={chat.retry}
            />
          )}

          {chat.error ? (
            <div className="mx-4 mb-1 flex w-full max-w-3xl items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 sm:mx-6">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
              <p className="flex-1 text-xs leading-relaxed text-danger">{chat.error}</p>
              {chat.canRetry ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] text-danger"
                  onClick={chat.retry}
                >
                  Retry
                </Button>
              ) : null}
              <IconButton
                label="Dismiss error"
                size="sm"
                icon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={chat.clearError}
              />
            </div>
          ) : null}

          <ChatInput
            value={composer}
            onChange={setComposer}
            onSend={handleSend}
            onStop={chat.cancel}
            isStreaming={chat.status === 'streaming'}
            sendOnEnter={sendOnEnter}
            attachedFiles={attachedFiles}
            availableFiles={availableFiles}
            onAttachFiles={handleAttachFiles}
            onAttachExisting={handleAttachExisting}
            onRemoveAttached={handleRemoveAttached}
            uploadingFiles={uploadingFiles}
            uploadError={uploadError}
            onDismissUploadError={dismissUploadError}
            onRetryUpload={canRetryUpload ? handleRetryUpload : undefined}
            maxChars={MAX_MESSAGE_CHARS}
            disabled={!providerReady}
            disabledReason={composerDisabledReason}
          />
        </>
      ) : null}

      {view === 'settings' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SettingsView
            provider={provider}
            models={models}
            activeModel={activeModel}
            onSelectModel={setActiveModel}
            documentCount={attachedFiles.length}
          />
        </div>
      ) : null}
    </AppShell>
  )
}

export default function App() {
  const path = usePathname()
  const auth = useAuth()

  if (auth.loading) return <AuthSplash />

  return <ChatApp initialView={path === '/settings' ? 'settings' : 'chat'} />
}
