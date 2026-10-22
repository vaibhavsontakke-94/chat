import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { AppShell } from './components/layout/AppShell'
import { ChatHeader } from './components/layout/ChatHeader'
import { Sidebar, type AppView } from './components/layout/Sidebar'
import { ChatEmptyState } from './components/chat/ChatEmptyState'
import { ChatInput } from './components/chat/ChatInput'
import { MessageList } from './components/chat/MessageList'
import { DocumentPanel } from './components/documents/DocumentPanel'
import { SettingsView } from './components/views/SettingsView'
import { Button } from './components/ui/Button'
import { IconButton } from './components/ui/IconButton'
import { useChat } from './hooks/useChat'
import { useDocuments } from './hooks/useDocuments'
import { usePreferences } from './hooks/usePreferences'
import { fetchModels, fetchProviderStatus } from './lib/api/chatClient'
import type { ModelOption, ProviderInfo } from './types/chat'
import { AuthButton } from './components/auth/AuthButton'
import { useAuth } from './lib/auth/AuthProvider'
import { useConversations } from './hooks/useConversations'
import { useServerDocuments } from './hooks/useServerDocuments'

const MAX_MESSAGE_CHARS = 8_000

export default function App() {
  const { sendOnEnter, showTimestamps } = usePreferences()
  const auth = useAuth()
  void useConversations()

  const [view, setView] = useState<AppView>('chat')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [composer, setComposer] = useState('')
  const [isRagEnabled] = useState(false)
  const [provider, setProvider] = useState<ProviderInfo>({
    status: 'unknown',
    provider: 'unknown',
    model: '',
  })
  const [models, setModels] = useState<ModelOption[]>([])
  const [activeModel, setActiveModel] = useState<string | null>(null)
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [persistedConvs] = useState<Array<{ id: string; title: string; created_at: string; updated_at: string }>>([])
  const [loadingHistory] = useState(false)
  const [historyError] = useState<string | null>(null)

  const [ragMode, setRagMode] = useState(false)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const chat = useChat({ model: activeModel, rag: ragMode, documentId: selectedDocId })
  const documents = useDocuments()
  const serverDocs = useServerDocuments()
  const [serverDocList, setServerDocList] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

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
          setIsLoadingModels(true)
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
      } finally {
        if (!controller.signal.aborted) setIsLoadingModels(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!auth.user) {
      setServerDocList([])
      return
    }
    serverDocs.list().then(setServerDocList).catch(() => setServerDocList([]))
  }, [auth.user?.id])

  const handleSend = useCallback(() => {
    const content = composer.trim()
    if (content.length === 0) return
    chat.sendMessage(content)
    setComposer('')
  }, [chat, composer])

  const handleServerFiles = useCallback(async (files: File[]) => {
    setUploadError(null)
    for (const f of files) {
      const lower = f.name.toLowerCase()
      if (!lower.endsWith('.pdf') && !lower.endsWith('.txt') && !lower.endsWith('.md') && !lower.endsWith('.docx') && !lower.endsWith('.doc') && !lower.endsWith('.csv') && !lower.endsWith('.json') && !lower.endsWith('.html') && !lower.endsWith('.htm')) {
        setUploadError('Only supported document types are allowed.')
        continue
      }
      setUploading(true)
      const res = await serverDocs.upload(f)
      setUploading(false)
      if (!res.ok) {
        setUploadError(res.message || 'Upload failed')
      } else {
        serverDocs.list().then(setServerDocList).catch(() => {})
      }
    }
  }, [serverDocs])

  const handleSelectSession = useCallback(
    (id: string) => {
      chat.selectSession(id)
      setView('chat')
      setIsSidebarOpen(false)
    },
    [chat],
  )

  const handleNewChat = useCallback(() => {
    chat.newChat()
    setView('chat')
    setIsSidebarOpen(false)
  }, [chat])

  const handleViewChange = useCallback((next: AppView) => {
    setView(next)
    setIsSidebarOpen(false)
  }, [])

  const headerTitle = useMemo(() => {
    if (view === 'documents') return 'Documents'
    if (view === 'settings') return 'Settings'
    return chat.activeSession.title
  }, [view, chat.activeSession.title])

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
      onDeleteSession={chat.deleteSession}
      onNewChat={handleNewChat}
      documentCount={documents.documents.length}
      provider={provider}
      isOpen={isSidebarOpen}
      onClose={() => setIsSidebarOpen(false)}
    />
  )

  const header = (
    <ChatHeader
      title={headerTitle}
      provider={provider}
      models={models}
      activeModel={activeModel}
      onSelectModel={setActiveModel}
      isLoadingModels={isLoadingModels}
      onOpenSidebar={() => setIsSidebarOpen(true)}
      onNewChat={handleNewChat}
    />
  )

  return (
    <AppShell
      sidebar={sidebar}
      header={header}
      isSidebarOpen={isSidebarOpen}
      onSidebarOpenChange={setIsSidebarOpen}
      headerRight={<AuthButton />}
    >
      {view === 'chat' ? (
        <>
          {isEmpty ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ChatEmptyState
                hasDocuments={documents.documents.length > 0}
                onPickPrompt={(prompt) => setComposer(prompt)}
              />
            </div>
          ) : (
            <MessageList
              messages={chat.activeSession.messages}
              showTimestamps={showTimestamps}
              onRetry={chat.retry}
            />
          )}

          {isRagEnabled && documents.documents.length === 0 ? (
            <p className="mx-4 mb-1 w-full max-w-3xl rounded-xl border border-line bg-surface/70 px-3.5 py-2.5 text-[11px] leading-relaxed text-ink-subtle sm:mx-6">
              Document mode is on, but nothing is attached yet. Add files from the Documents panel -
              indexing arrives with the RAG stage.
            </p>
          ) : null}

          {chat.error ? (
            <div className="mx-4 mb-1 flex w-full max-w-3xl items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 sm:mx-6">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
              <p className="flex-1 text-xs leading-relaxed text-danger">{chat.error}</p>
              {chat.canRetry ? (
                <Button variant="ghost" size="sm" className="h-7 text-[11px] text-danger" onClick={chat.retry}>
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
            documentCount={serverDocList.length + documents.documents.length}
            onAttachFiles={(files) => {
              if (auth.user) handleServerFiles(files)
              else documents.addFiles(files)
            }}
            maxChars={MAX_MESSAGE_CHARS}
            disabled={!providerReady}
            disabledReason={composerDisabledReason}
          />
          {ragMode && auth.user ? (
            <div className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 px-4 text-xs text-ink-muted sm:px-6">
              <span>Search in:</span>
              <select
                className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
                value={selectedDocId ?? ''}
                onChange={(e) => setSelectedDocId(e.target.value || null)}
              >
                <option value="">All documents</option>
                {serverDocList.filter((d: any) => d.status === 'ready').map((d: any) => (
                  <option key={d.id} value={d.id}>{d.filename}</option>
                ))}
              </select>
            </div>
          ) : null}
        </>
      ) : null}

      {view === 'documents' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DocumentPanel
            documents={documents.documents}
            onFiles={documents.addFiles}
            onRemove={documents.remove}
            onClear={documents.clear}
            serverDocuments={auth.user ? serverDocList : []}
            onServerRemove={async (id) => {
              await serverDocs.remove(id)
              setServerDocList(await serverDocs.list())
            }}
            onChatWithDocument={(id) => {
              setSelectedDocId(id)
              setRagMode(true)
              setView('chat')
              setIsSidebarOpen(false)
            }}
            uploading={uploading}
            uploadError={uploadError}
            onServerUpload={auth.user ? handleServerFiles : undefined}
          />
        </div>
      ) : null}

      {view === 'settings' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SettingsView
            provider={provider}
            models={models}
            activeModel={activeModel}
            onSelectModel={setActiveModel}
            documentCount={documents.documents.length}
          />
        </div>
      ) : null}
    </AppShell>
  )
}
