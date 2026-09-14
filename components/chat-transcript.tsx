'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import {
  Virtuoso,
  type Components,
  type ListProps,
  type VirtuosoHandle,
} from 'react-virtuoso'

import { ChatMessage } from '@/components/chat-message'
import styles from '@/components/channel-viewer.module.css'
import type { PublicChatMessage } from '@/lib/chat-types'

const localDayFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full',
})

function localDayKey(timestamp: string): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

interface ChatTranscriptEntry {
  message: PublicChatMessage
  startsLocalDay: boolean
}

interface ChatTranscriptContext {
  hasOlderHistory: boolean
}

function TranscriptHeader({
  context,
}: {
  context: ChatTranscriptContext
}) {
  if (context.hasOlderHistory) return null
  return (
    <div className={styles.chatNotice}>
      This is the start of the last seven days.
    </div>
  )
}

function EmptyTranscript() {
  return <div className={styles.chatNotice}>No messages yet.</div>
}

const TranscriptList = forwardRef<HTMLDivElement, ListProps>(
  function TranscriptList({ children, ...props }, ref) {
    return (
      <div {...props} ref={ref} role="list">
        {children}
      </div>
    )
  },
)

const transcriptComponents: Components<
  ChatTranscriptEntry,
  ChatTranscriptContext
> = {
  EmptyPlaceholder: EmptyTranscript,
  Header: TranscriptHeader,
  List: TranscriptList,
}

interface ChatTranscriptProps {
  atBottom: boolean
  firstItemIndex: number
  hasOlderHistory: boolean
  loadingOlderHistory: boolean
  messages: PublicChatMessage[]
  onAtBottomChange: (atBottom: boolean) => void
  onLoadOlder: () => void
  realtimeState: 'connected' | 'connecting' | 'disconnected'
}

export function ChatTranscript({
  atBottom,
  firstItemIndex,
  hasOlderHistory,
  loadingOlderHistory,
  messages,
  onAtBottomChange,
  onLoadOlder,
  realtimeState,
}: ChatTranscriptProps) {
  const initialPositionSetRef = useRef(false)
  const atBottomRef = useRef(atBottom)
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  const entries = useMemo(
    () =>
      messages.map((message, index) => ({
        message,
        startsLocalDay:
          index === 0 ||
          localDayKey(messages[index - 1].serverTimestamp) !==
            localDayKey(message.serverTimestamp),
      })),
    [messages],
  )
  const context = useMemo(
    () => ({
      hasOlderHistory,
    }),
    [hasOlderHistory],
  )
  const handleStartReached = useCallback(() => {
    if (initialPositionSetRef.current && !atBottomRef.current) onLoadOlder()
  }, [onLoadOlder])
  const handleAtBottomChange = useCallback(
    (nextAtBottom: boolean) => {
      atBottomRef.current = nextAtBottom
      onAtBottomChange(nextAtBottom)
    },
    [onAtBottomChange],
  )
  const scrollToLiveEnd = useCallback(() => {
    handleAtBottomChange(true)
    virtuosoRef.current?.scrollToIndex({ align: 'end', index: 'LAST' })
  }, [handleAtBottomChange])

  useEffect(() => {
    if (initialPositionSetRef.current || entries.length === 0) return
    const frame = requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ align: 'end', index: 'LAST' })
      initialPositionSetRef.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [entries.length])

  return (
    <>
      <Virtuoso
        alignToBottom
        aria-busy={loadingOlderHistory}
        aria-label="Chat messages"
        aria-live="off"
        atBottomStateChange={handleAtBottomChange}
        atBottomThreshold={2}
        className={styles.chatTranscript}
        components={transcriptComponents}
        computeItemKey={(_index, entry) => entry.message.id}
        context={context}
        data={entries}
        data-at-bottom={atBottom ? 'true' : 'false'}
        data-realtime-state={realtimeState}
        defaultItemHeight={68}
        firstItemIndex={firstItemIndex}
        followOutput="auto"
        itemContent={(_index, entry) => (
          <div
            className={styles.chatTranscriptItem}
            role="listitem"
          >
            {entry.startsLocalDay && (
              <div className={styles.chatDaySeparator} role="separator">
                <time dateTime={entry.message.serverTimestamp}>
                  {localDayFormatter.format(
                    new Date(entry.message.serverTimestamp),
                  )}
                </time>
              </div>
            )}
            <ChatMessage message={entry.message} />
          </div>
        )}
        minOverscanItemCount={{ bottom: 4, top: 4 }}
        ref={virtuosoRef}
        role="log"
        startReached={handleStartReached}
      />
      {!atBottom && messages.length > 0 && (
        <button
          className={styles.chatNewMessages}
          onClick={scrollToLiveEnd}
          type="button"
        >
          New messages
        </button>
      )}
    </>
  )
}
