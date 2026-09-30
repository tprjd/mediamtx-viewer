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
import { useChatTextSize } from '@/components/chat-settings'
import styles from '@/components/channel-viewer.module.css'
import { buildChatTranscriptEntries, type ChatHistoryEntry } from '@/lib/chat-client-state'
import type { PublicChatMessage, ChatModeratorRole } from '@/lib/chat-types'

const localDayFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full',
})

type ChatTranscriptEntry =
  | ChatHistoryEntry
  | { kind: 'submission'; submission: ChatSubmission }

function EmptyTranscript() {
  return <div className={styles.chatNotice}>No messages yet.</div>
}

function readingAnchor(scroller: HTMLElement) {
  const top = scroller.getBoundingClientRect().top
  const anchor = Array.from(
    scroller.querySelectorAll<HTMLElement>('[data-message-entry-id]'),
  ).find(element => element.getBoundingClientRect().bottom > top)
  return anchor ? {
    id: anchor.dataset.messageEntryId!,
    top: anchor.getBoundingClientRect().top - top,
  } : null
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
  const textSize = useChatTextSize()
  const regionRef = useRef<HTMLDivElement | null>(null)
  const initialPositionSetRef = useRef(false)
  const readerNavigatedRef = useRef(false)
  const liveEndFrameRef = useRef<number | null>(null)
  const touchStartYRef = useRef<number | null>(null)
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
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) readerNavigatedRef.current = true
    }
    const onTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? null
    }
    const onTouchMove = (event: TouchEvent) => {
      if (touchStartYRef.current !== null &&
        (event.touches[0]?.clientY ?? touchStartYRef.current) >
          touchStartYRef.current) {
        readerNavigatedRef.current = true
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target === scroller) readerNavigatedRef.current = true
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) ||
        (event.key === ' ' && event.shiftKey)) {
        readerNavigatedRef.current = true
      }
    }
    scroller.addEventListener('wheel', onWheel)
    scroller.addEventListener('touchstart', onTouchStart)
    scroller.addEventListener('touchmove', onTouchMove)
    scroller.addEventListener('pointerdown', onPointerDown)
    scroller.addEventListener('keydown', onKeyDown)
    return () => {
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('touchstart', onTouchStart)
      scroller.removeEventListener('touchmove', onTouchMove)
      scroller.removeEventListener('pointerdown', onPointerDown)
      scroller.removeEventListener('keydown', onKeyDown)
      if (liveEndFrameRef.current !== null) {
        cancelAnimationFrame(liveEndFrameRef.current)
      }
    }
  }, [])
  const handleStartReached = useCallback(() => {
    const scroller = scrollerRef.current
    if (initialPositionSetRef.current && scroller &&
      scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 2) {
      historyAnchorRef.current = readingAnchor(scroller)
      onLoadOlder()
    }
  }, [onLoadOlder])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const region = regionRef.current
    let keepAtBottom = false
    if (region && region.dataset.textSize !== textSize) {
      // Capture the visible message before CSS changes its height.
      if (scroller && initialPositionSetRef.current) {
        keepAtBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
        if (!keepAtBottom) historyAnchorRef.current = readingAnchor(scroller)
      }
      region.dataset.textSize = textSize
    }
    const anchor = historyAnchorRef.current
    if (!anchor && !keepAtBottom) return
    historyAnchorRef.current = null
    // Prepending can move the first day separator. Virtuoso preserves item indexes,
    // but the moved separator also changes the height before the visible message.
    let frame = 0
    let attempts = 0
    let previousScrollTop = 0
    let cancelled = false
    const cancel = () => { cancelled = true }
    const inputEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown']
    for (const event of inputEvents) scroller?.addEventListener(event, cancel)
    const restore = () => {
      // Stop if the reader returns to the start while measurements settle.
      if (cancelled || (previousScrollTop > 0 && scroller?.scrollTop === 0)) return
      const element = anchor && scroller && Array.from(
        scroller.querySelectorAll<HTMLElement>('[data-message-entry-id]'),
      ).find(element => element.dataset.messageEntryId === anchor.id)
      if (keepAtBottom) {
        virtuosoRef.current?.scrollToIndex({ align: 'end', index: 'LAST' })
      } else if (scroller && element && anchor) {
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
  }, [firstItemIndex, textSize])
  const pinToLiveEnd = useCallback(() => {
    if (liveEndFrameRef.current !== null || !initialPositionSetRef.current) return
    let attempts = 0
    const pin = () => {
      liveEndFrameRef.current = null
      if (readerNavigatedRef.current) return
      const scroller = scrollerRef.current
      if (!scroller || scroller.clientHeight === 0) return
      scroller.scrollTop = scroller.scrollHeight
      const lastItem = scroller.querySelector(`[data-index="${entries.length - 1}"]`)
      const atBottom = scroller.scrollTop + scroller.clientHeight >=
        scroller.scrollHeight - 2
      if (lastItem && atBottom && scroller.dataset.atBottom === 'true') return
      if (++attempts < 120) liveEndFrameRef.current = requestAnimationFrame(pin)
    }
    liveEndFrameRef.current = requestAnimationFrame(pin)
  }, [entries.length])
  const handleAtBottomChange = useCallback((nextAtBottom: boolean) => {
    if (nextAtBottom) readerNavigatedRef.current = false
    if (nextAtBottom || readerNavigatedRef.current ||
      !initialPositionSetRef.current) {
      onAtBottomChange(nextAtBottom)
    } else {
      // Resizing or measuring messages can move the scroller off the live end.
      pinToLiveEnd()
    }
  }, [onAtBottomChange, pinToLiveEnd])
  const scrollToLiveEnd = useCallback(() => {
    readerNavigatedRef.current = false
    virtuosoRef.current?.scrollToIndex({ align: 'end', index: 'LAST' })
  }, [])
  const followOutput = useCallback((isAtBottom: boolean) =>
    !readerNavigatedRef.current || isAtBottom ? 'auto' : false,
  [])

  useEffect(() => {
    if (initialPositionSetRef.current || entries.length === 0) return
    let frame = 0
    let attempts = 0
    let stableFrames = 0
    const region = regionRef.current
    const stopForReader = () => {
      initialPositionSetRef.current = true
      cancelAnimationFrame(frame)
    }
    const inputEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown']
    for (const event of inputEvents) region?.addEventListener(event, stopForReader)
    const pinToLiveEnd = () => {
      const scroller = scrollerRef.current
      if (scroller && scroller.clientHeight > 0) {
        // Message measurements can increase the height after the first jump.
        scroller.scrollTop = scroller.scrollHeight
        const lastItem = scroller.querySelector(`[data-index="${entries.length - 1}"]`)
        const atBottom = scroller.scrollTop + scroller.clientHeight >=
          scroller.scrollHeight - 2
        stableFrames = lastItem && atBottom && scroller.dataset.atBottom === 'true'
          ? stableFrames + 1
          : 0
        if (stableFrames >= 2) {
          initialPositionSetRef.current = true
          return
        }
      }
      if (++attempts < 120) frame = requestAnimationFrame(pinToLiveEnd)
      else initialPositionSetRef.current = true
    }
    frame = requestAnimationFrame(pinToLiveEnd)
    return () => {
      cancelAnimationFrame(frame)
      for (const event of inputEvents) region?.removeEventListener(event, stopForReader)
    }
  }, [entries.length])

  return (
    <div className={styles.chatTranscriptRegion} ref={regionRef}>
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
        followOutput={followOutput}
        initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
        itemContent={(_index, entry) => {
          if (entry.kind === 'submission') {
            return (
              <div className={styles.chatTranscriptItem} role="listitem">
                <div className={styles.chatMessage}>
                  <span className={styles.chatMessageBody}>
                    {entry.submission.content}
                  </span>
                </div>
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
