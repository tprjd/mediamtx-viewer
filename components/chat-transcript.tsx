'use client'

import { forwardRef, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Virtuoso,
  type Components,
  type ListProps,
  type VirtuosoHandle,
} from 'react-virtuoso'

import type { ChatSubmission } from '@/components/use-chat-sending'
import { ChatMessage } from '@/components/chat-message'
import styles from '@/components/channel-viewer.module.css'
import type { PublicChatMessage, ChatModeratorRole } from '@/lib/chat-types'

const localDayFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full',
})

function localDayKey(timestamp: string): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

interface ChatMessageEntry {
  kind: 'message'
  message: PublicChatMessage
}

interface ChatDaySeparatorEntry {
  dayKey: string
  kind: 'day-separator'
  serverTimestamp: string
}

interface HistoryBoundaryEntry {
  kind: 'history-boundary'
}

type ChatTranscriptEntry =
  | ChatDaySeparatorEntry
  | ChatMessageEntry
  | HistoryBoundaryEntry
  | { kind: 'submission'; submission: ChatSubmission }

function buildChatTranscriptEntries(
  messages: PublicChatMessage[],
  historyExhausted: boolean,
): ChatTranscriptEntry[] {
  const entries: ChatTranscriptEntry[] = []
  if (historyExhausted && messages.length > 0) {
    entries.push({ kind: 'history-boundary' })
  }
  let previousDay: string | null = null
  for (const message of messages) {
    const dayKey = localDayKey(message.serverTimestamp)
    if (dayKey !== previousDay) {
      entries.push({
        dayKey,
        kind: 'day-separator',
        serverTimestamp: message.serverTimestamp,
      })
    }
    entries.push({ kind: 'message', message })
    previousDay = dayKey
  }
  return entries
}

export function chatTranscriptEntryCount(
  messages: PublicChatMessage[],
  historyExhausted: boolean,
): number {
  return buildChatTranscriptEntries(messages, historyExhausted).length
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

const transcriptComponents: Components<ChatTranscriptEntry> = {
  EmptyPlaceholder: EmptyTranscript,
  List: TranscriptList,
}

interface ChatTranscriptProps {
  channelSlug?: string
  moderatorRole?: ChatModeratorRole
  onRemoved?: (message: PublicChatMessage) => void
  atBottom: boolean
  firstItemIndex: number
  historyExhausted: boolean
  loadingOlderHistory: boolean
  messages: PublicChatMessage[]
  onAtBottomChange: (atBottom: boolean) => void
  onLoadOlder: () => void
  submissions?: ChatSubmission[]
  onRetry?: (submission: ChatSubmission) => void
  retryDisabled?: boolean
  realtimeState: 'connected' | 'connecting' | 'disconnected'
}

export function ChatTranscript({
  channelSlug,
  moderatorRole,
  onRemoved,
  atBottom,
  firstItemIndex,
  historyExhausted,
  loadingOlderHistory,
  messages,
  onAtBottomChange,
  onLoadOlder,
  realtimeState,
  submissions = [],
  onRetry,
  retryDisabled = false,
}: ChatTranscriptProps) {
  const initialPositionSetRef = useRef(false)
  const atBottomRef = useRef(atBottom)
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  const entries = useMemo<ChatTranscriptEntry[]>(
    () => [
      ...buildChatTranscriptEntries(messages, historyExhausted),
      ...submissions
        .filter((submission) => !submission.message)
        .map((submission) => ({ kind: 'submission' as const, submission })),
    ],
    [historyExhausted, messages, submissions],
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
        computeItemKey={(_index, entry) => {
          if (entry.kind === 'submission') return entry.submission.key
          if (entry.kind === 'history-boundary') return 'history-boundary'
          if (entry.kind === 'day-separator') {
            return `day-separator:${entry.dayKey}`
          }
          return entry.message.id
        }}
        data={entries}
        data-at-bottom={atBottom ? 'true' : 'false'}
        data-realtime-state={realtimeState}
        defaultItemHeight={72}
        firstItemIndex={firstItemIndex}
        followOutput="auto"
        itemContent={(_index, entry) => {
          if (entry.kind === 'submission') {
            return (
              <div className={styles.chatTranscriptItem} role="listitem">
                <p>{entry.submission.content}</p>
                <span>
                  {entry.submission.state === 'sending'
                    ? 'Sending'
                    : 'Could not send.'}
                </span>
                {entry.submission.state === 'failed' && (
                  <button
                    type="button"
                    disabled={retryDisabled}
                    onClick={() => onRetry?.(entry.submission)}
                  >
                    Retry
                  </button>
                )}
              </div>
            )
          }
          if (entry.kind === 'history-boundary') {
            return (
              <div className={styles.chatNotice} role="listitem">
                This is the start of the last seven days.
              </div>
            )
          }
          if (entry.kind === 'day-separator') {
            return (
              <div className={styles.chatTranscriptItem} role="listitem">
                <div className={styles.chatDaySeparator} role="separator">
                  <time dateTime={entry.serverTimestamp}>
                    {localDayFormatter.format(new Date(entry.serverTimestamp))}
                  </time>
                </div>
              </div>
            )
          }
          return (
            <div
              className={styles.chatTranscriptItem}
              data-message-entry-id={entry.message.id}
              role="listitem"
            >
              <ChatMessage
                message={entry.message}
                channelSlug={channelSlug}
                moderatorRole={moderatorRole}
                onRemoved={onRemoved}
              />
              {submissions.some(
                (submission) =>
                  submission.state === 'delayed' &&
                  submission.message?.id === entry.message.id,
              ) && <span>Delayed</span>}
            </div>
          )
        }}
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
