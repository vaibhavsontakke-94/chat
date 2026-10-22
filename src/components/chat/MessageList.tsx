import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import type { ChatMessage } from '../../types/chat'
import { cn } from '../../lib/cn'
import { IconButton } from '../ui/IconButton'
import { MessageBubble } from './MessageBubble'

export interface MessageListProps {
  messages: ChatMessage[]
  showTimestamps: boolean
  onRetry: () => void
}

const BOTTOM_THRESHOLD = 120

export function MessageList({ messages, showTimestamps, onRetry }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pinnedToBottom, setPinnedToBottom] = useState(true)

  const lastMessage = messages[messages.length - 1]
  const lastContentLength = lastMessage?.content.length ?? 0
  const lastStatus = lastMessage?.status ?? 'complete'

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = containerRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior })
  }, [])

  useLayoutEffect(() => {
    if (!pinnedToBottom) return
    scrollToBottom('auto')
  }, [messages.length, lastContentLength, lastStatus, pinnedToBottom, scrollToBottom])

  const handleScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight
    setPinnedToBottom(distance <= BOTTOM_THRESHOLD)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => {
      if (pinnedToBottom) scrollToBottom('auto')
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [pinnedToBottom, scrollToBottom])

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto overscroll-contain px-4 py-6 sm:px-6"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              showTimestamp={showTimestamps}
              onRetry={onRetry}
            />
          ))}
        </div>
      </div>

      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-4 flex justify-center transition-opacity duration-200',
          pinnedToBottom ? 'opacity-0' : 'opacity-100',
        )}
      >
        <IconButton
          label="Scroll to latest message"
          variant="solid"
          onClick={() => scrollToBottom('smooth')}
          className="pointer-events-auto shadow-lg"
        >
          <ArrowDown className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  )
}
