'use client'

import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
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
  showTimestamps?: boolean
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
  showTimestamps = false,
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
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const historyAnchorRef = useRef<{ id: string; top: number } | null>(null)
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
    const scroller = scrollerRef.current
    if (initialPositionSetRef.current && scroller &&
      scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 2) {
      const top = scroller?.getBoundingClientRect().top ?? 0
      const anchor = scroller && Array.from(
        scroller.querySelectorAll<HTMLElement>('[data-message-entry-id]'),
      ).find(element => element.getBoundingClientRect().bottom > top)
      if (anchor) historyAnchorRef.current = {
        id: anchor.dataset.messageEntryId!,
        top: anchor.getBoundingClientRect().top - top,
      }
      onLoadOlder()
    }
  }, [onLoadOlder])

  useLayoutEffect(() => {
    const anchor = historyAnchorRef.current
    if (!anchor) return
    historyAnchorRef.current = null
    // Prepending can move the first day separator. Virtuoso preserves item indexes,
    // but the moved separator also changes the height before the visible message.
    let frame = 0
    let attempts = 0
    let previousScrollTop = 0
    const scroller = scrollerRef.current
    let cancelled = false
    const cancel = () => { cancelled = true }
    const inputEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown']
    for (const event of inputEvents) scroller?.addEventListener(event, cancel)
    const restore = () => {
      // Stop if the reader returns to the start while measurements settle.
      if (cancelled || (previousScrollTop > 0 && scroller?.scrollTop === 0)) return
      const element = scroller && Array.from(
        scroller.querySelectorAll<HTMLElement>('[data-message-entry-id]'),
      ).find(element => element.dataset.messageEntryId === anchor.id)
      if (scroller && element) {
        scroller.scrollTop += element.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top - anchor.top
        previousScrollTop = scroller.scrollTop
      }
      if (++attempts < 8) frame = requestAnimationFrame(restore)
    }
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(restore)
    })
    return () => {
      cancelAnimationFrame(frame)
      for (const event of inputEvents) scroller?.removeEventListener(event, cancel)
    }
  }, [firstItemIndex])
  const handleAtBottomChange = useCallback(
    (nextAtBottom: boolean) => {
      onAtBottomChange(nextAtBottom)
    },
    [onAtBottomChange],
  )
  const scrollToLiveEnd = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ align: 'end', index: 'LAST' })
  }, [])

  useEffect(() => {
    if (initialPositionSetRef.current || entries.length === 0) return
    const frame = requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ align: 'end', index: 'LAST' })
      initialPositionSetRef.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [entries.length])

  return (
    <div className={styles.chatTranscriptRegion}>
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
                showTimestamps={showTimestamps}
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
        scrollerRef={element => {
          scrollerRef.current = element instanceof HTMLElement ? element : null
        }}
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
    </div>
  )
}
