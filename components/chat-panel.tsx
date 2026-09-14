'use client'

import { Send } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ChatFrame } from '@/components/chat-frame'
import {
  ChatTranscript,
  chatTranscriptEntryCount,
} from '@/components/chat-transcript'
import { useChatSending } from '@/components/use-chat-sending'
import { useChatRealtime } from '@/components/use-chat-realtime'
import styles from '@/components/channel-viewer.module.css'
import {
  chatRequestBlocksSending,
  firstChatSequenceGap,
  mergeChatHistoryPages,
  mergeChatMessages,
} from '@/lib/chat-client-state'
import type { ChatHistoryPage, PublicChatMessage } from '@/lib/chat-types'

interface ChatPanelProps {
  channelSlug: string
  open?: boolean
  focusComposer?: boolean
  closeButtonRef?: (element: HTMLButtonElement | null) => void
  narrowLayout: boolean
  onClose: () => void
}

interface ChatPanelContentProps {
  isChatVisible: boolean
  channelSlug: string
  endpoint: string
  focusComposer: boolean
}

interface HistoryResponse extends Partial<ChatHistoryPage> {
  error?: string
}

interface ChatAnnouncement {
  id: number
  text: string
}

const INITIAL_FIRST_ITEM_INDEX = 1_000_000_000

function ChatPanelContent({
  channelSlug,
  endpoint,
  isChatVisible,
  focusComposer,
}: ChatPanelContentProps) {
  const [messages, setMessages] = useState<PublicChatMessage[]>([])
  const messagesRef = useRef<PublicChatMessage[]>([])
  const reconciliationRef = useRef<Promise<void> | null>(null)
  const pendingReconciliationRef = useRef<number | null>(null)
  const requestGenerationRef = useRef(0)
  const wasChatVisibleRef = useRef(isChatVisible)
  const composerRef = useRef<HTMLInputElement | null>(null)
  const composingRef = useRef(false)
  const [confirmedIds, setConfirmedIds] = useState<ReadonlySet<string>>(
    new Set(),
  )
  const [unavailable, setUnavailable] = useState(false)
  const [transcriptVisit, setTranscriptVisit] = useState(0)
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [firstItemIndex, setFirstItemIndex] = useState(INITIAL_FIRST_ITEM_INDEX)
  const [atBottom, setAtBottom] = useState(true)
  const atBottomRef = useRef(true)
  const hasOlderHistoryRef = useRef(false)
  const [historyExhausted, setHistoryExhausted] = useState(false)
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false)
  const loadingOlderHistoryRef = useRef(false)
  const [announcement, setAnnouncement] = useState<ChatAnnouncement | null>(
    null,
  )
  const announcementIdRef = useRef(0)
  const historyCursorRef = useRef<string | null>(null)

  const updateAtBottomState = useCallback((nextAtBottom: boolean) => {
    atBottomRef.current = nextAtBottom
    setAtBottom(nextAtBottom)
    if (!nextAtBottom) setAnnouncement(null)
  }, [])

  const updateHistoryAvailability = useCallback((hasMore: boolean) => {
    hasOlderHistoryRef.current = hasMore
  }, [])

  const updateOlderHistoryLoading = useCallback((isLoading: boolean) => {
    loadingOlderHistoryRef.current = isLoading
    setLoadingOlderHistory(isLoading)
  }, [])

  const applyHistoryPageMetadata = useCallback(
    (page: Pick<HistoryResponse, 'hasMore' | 'cursor'>) => {
      const hasMore = page.hasMore === true
      const cursor = hasMore ? (page.cursor ?? null) : null
      historyCursorRef.current = cursor
      updateHistoryAvailability(hasMore)
      setHistoryExhausted(!hasMore)
    },
    [updateHistoryAvailability],
  )

  const resetChatPanelState = useCallback(() => {
    requestGenerationRef.current += 1
    reconciliationRef.current = null
    pendingReconciliationRef.current = null
    historyCursorRef.current = null
    updateOlderHistoryLoading(false)
    updateHistoryAvailability(false)
    setHistoryExhausted(false)
    updateAtBottomState(true)
    setLoading(messagesRef.current.length === 0)
    setAccessDenied(false)
    setError(null)
    setFirstItemIndex(INITIAL_FIRST_ITEM_INDEX)
    setAnnouncement(null)
  }, [
    updateAtBottomState,
    updateHistoryAvailability,
    updateOlderHistoryLoading,
  ])

  const announceMessage = useCallback((message: PublicChatMessage) => {
    announcementIdRef.current += 1
    setAnnouncement({
      id: announcementIdRef.current,
      text: `${message.profileName}: ${message.content}`,
    })
  }, [])

  const confirmMessages = useCallback((incoming: PublicChatMessage[]) => {
    setConfirmedIds(
      (current) =>
        new Set([
          ...current,
          ...incoming.flatMap(({ id, submissionId }) =>
            submissionId ? [id, submissionId] : [id],
          ),
        ]),
    )
  }, [])

  const checkAvailability = useCallback((response: Response) => {
    if (chatRequestBlocksSending(response.status)) setUnavailable(true)
    else if (response.ok) setUnavailable(false)
  }, [])

  const mergeMessages = useCallback((incoming: PublicChatMessage[]) => {
    const previous = messagesRef.current
    const knownIds = new Set(previous.map(({ id }) => id))
    const merged = mergeChatMessages(previous, incoming)
    messagesRef.current = merged
    setMessages(merged)
    return {
      added: incoming.filter(({ id }) => !knownIds.has(id)),
      merged,
    }
  }, [])

  const mergeAndAnnounceMessage = useCallback(
    (message: PublicChatMessage) => {
      const { added } = mergeMessages([message])
      if (isChatVisible && atBottomRef.current && added.length > 0) {
        announceMessage(message)
      }
      return added
    },
    [announceMessage, isChatVisible, mergeMessages],
  )

  const mergeOlderPage = useCallback(
    (older: PublicChatMessage[], historyEnds: boolean) => {
      const previous = messagesRef.current
      const merged = mergeChatHistoryPages(previous, older)
      const previousEntryCount = chatTranscriptEntryCount(previous, false)
      const nextEntryCount = chatTranscriptEntryCount(merged, historyEnds)
      const addedEntryCount = nextEntryCount - previousEntryCount
      messagesRef.current = merged
      setMessages(merged)
      if (addedEntryCount > 0) {
        setFirstItemIndex((current) => current - addedEntryCount)
      }
      return merged
    },
    [],
  )

  const reconcile = useCallback(
    (afterSequence?: number) => {
      const requestedAfter =
        afterSequence ?? messagesRef.current.at(-1)?.sequence ?? 0
      pendingReconciliationRef.current =
        pendingReconciliationRef.current === null
          ? requestedAfter
          : Math.min(pendingReconciliationRef.current, requestedAfter)
      if (reconciliationRef.current) return
      const requestGeneration = requestGenerationRef.current
      const work = (async () => {
        while (pendingReconciliationRef.current !== null) {
          let after = pendingReconciliationRef.current
          pendingReconciliationRef.current = null
          let hasMore = true
          while (hasMore) {
            if (requestGeneration !== requestGenerationRef.current) return
            const response = await fetch(`${endpoint}?after=${after}`, {
              cache: 'no-store',
            })
            if (requestGeneration !== requestGenerationRef.current) return
            checkAvailability(response)
            const result = (await response.json()) as HistoryResponse
            if (requestGeneration !== requestGenerationRef.current) return
            if (!response.ok) {
              throw new Error(result.error ?? 'Could not reconcile Chat.')
            }
            const incoming = result.messages ?? []
            setError(null)
            mergeMessages(incoming)
            confirmMessages(incoming)
            after = incoming.at(-1)?.sequence ?? after
            hasMore = result.hasMore === true && incoming.length > 0
          }
        }
      })()
        .catch((reconcileError: unknown) => {
          if (requestGeneration !== requestGenerationRef.current) return
          setError(
            reconcileError instanceof Error
              ? reconcileError.message
              : 'Could not reconcile Chat.',
          )
        })
        .finally(() => {
          if (requestGeneration === requestGenerationRef.current) {
            reconciliationRef.current = null
          }
        })
      reconciliationRef.current = work
    },
    [checkAvailability, confirmMessages, endpoint, mergeMessages],
  )

  const receiveMessage = useCallback(
    (message: PublicChatMessage) => {
      if (!isChatVisible) return
      const lastSequence = messagesRef.current.at(-1)?.sequence
      mergeAndAnnounceMessage(message)
      confirmMessages([message])
      if (lastSequence !== undefined && message.sequence > lastSequence + 1) {
        reconcile(lastSequence)
      }
    },
    [confirmMessages, isChatVisible, mergeAndAnnounceMessage, reconcile],
  )

  const loadOlderHistory = useCallback(async () => {
    const cursor = historyCursorRef.current
    if (
      !cursor ||
      !hasOlderHistoryRef.current ||
      loadingOlderHistoryRef.current
    ) {
      return
    }
    const requestGeneration = requestGenerationRef.current
    updateOlderHistoryLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `${endpoint}?before=${encodeURIComponent(cursor)}`,
        { cache: 'no-store' },
      )
      if (requestGeneration !== requestGenerationRef.current) return
      checkAvailability(response)
      const result = (await response.json()) as HistoryResponse
      if (requestGeneration !== requestGenerationRef.current) return
      if (!response.ok) {
        throw new Error(result.error ?? 'Could not load Chat history.')
      }
      mergeOlderPage(result.messages ?? [], result.hasMore !== true)
      applyHistoryPageMetadata(result)
    } catch (historyError: unknown) {
      if (requestGeneration !== requestGenerationRef.current) return
      setError(
        historyError instanceof Error
          ? historyError.message
          : 'Could not load Chat history.',
      )
    } finally {
      if (requestGeneration !== requestGenerationRef.current) return
      updateOlderHistoryLoading(false)
    }
  }, [
    applyHistoryPageMetadata,
    checkAvailability,
    endpoint,
    mergeOlderPage,
    updateOlderHistoryLoading,
  ])

  useEffect(() => {
    if (!isChatVisible) {
      if (wasChatVisibleRef.current) {
        wasChatVisibleRef.current = false
        requestGenerationRef.current += 1
        reconciliationRef.current = null
        pendingReconciliationRef.current = null
        setAnnouncement(null)
      }
      return
    }
    if (wasChatVisibleRef.current) return
    wasChatVisibleRef.current = true
    resetChatPanelState()
  }, [isChatVisible, resetChatPanelState])

  const realtimeState = useChatRealtime({
    active: isChatVisible,
    channelSlug,
    onMessage: receiveMessage,
    onRecoveryFailed: reconcile,
  })

  useEffect(() => {
    if (!isChatVisible) return

    const requestGeneration = requestGenerationRef.current
    const controller = new AbortController()
    const latestRequestSequence = messagesRef.current.at(-1)?.sequence ?? 0
    void fetch(endpoint, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (requestGeneration !== requestGenerationRef.current) return
        checkAvailability(response)
        const result = (await response.json()) as HistoryResponse
        if (requestGeneration !== requestGenerationRef.current) return
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true)
        }
        if (!response.ok)
          throw new Error(result.error ?? 'Could not load Chat.')
        const incoming = result.messages ?? []
        // Reopening starts with the latest page. Keep loaded history until it succeeds.
        messagesRef.current = messagesRef.current.filter(
          (message) =>
            message.sequence >
            Math.max(latestRequestSequence, incoming.at(-1)?.sequence ?? 0),
        )
        const { merged } = mergeMessages(incoming)
        confirmMessages(incoming)
        setError(null)
        setTranscriptVisit((visit) => visit + 1)
        applyHistoryPageMetadata(result)
        const gap = firstChatSequenceGap(merged)
        if (gap !== null) reconcile(gap)
      })
      .catch((loadError: unknown) => {
        if (
          controller.signal.aborted ||
          requestGeneration !== requestGenerationRef.current
        ) {
          return
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load Chat.',
        )
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          requestGeneration === requestGenerationRef.current
        ) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [
    applyHistoryPageMetadata,
    checkAvailability,
    confirmMessages,
    endpoint,
    isChatVisible,
    mergeMessages,
    reconcile,
  ])

  const sending = useChatSending({
    endpoint,
    connected: realtimeState === 'connected',
    confirmedIds,
    unavailable: unavailable || accessDenied || loading,
    onUnavailable: () => setUnavailable(true),
    onAccepted: mergeAndAnnounceMessage,
  })
  const delayed = sending.submissions.some((entry) => entry.state === 'delayed')
  const previousRealtimeState = useRef(realtimeState)
  const delayedAfter = Math.min(
    ...sending.submissions.flatMap((entry) =>
      entry.message ? [entry.message.sequence - 1] : [],
    ),
  )
  useEffect(() => {
    if (
      realtimeState === 'connected' &&
      previousRealtimeState.current !== 'connected'
    ) {
      // Include accepted sends whose publications were lost during the outage.
      reconcile(
        Math.min(delayedAfter, messagesRef.current.at(-1)?.sequence ?? 0),
      )
    }
    previousRealtimeState.current = realtimeState
  }, [delayedAfter, realtimeState, reconcile])

  useEffect(() => {
    if (!isChatVisible || !unavailable) return
    const timer = setInterval(() => reconcile(0), 3_000)
    return () => clearInterval(timer)
  }, [isChatVisible, unavailable, reconcile])

  useEffect(() => {
    if (isChatVisible && focusComposer && !loading && !unavailable)
      composerRef.current?.focus()
  }, [focusComposer, isChatVisible, loading, unavailable])

  const sendDisabled =
    loading ||
    sending.sending ||
    accessDenied ||
    unavailable ||
    sending.remainingSeconds > 0

  return (
    <>
      {loading ? (
        <div
          aria-busy="true"
          aria-label="Chat messages"
          className={styles.chatTranscript}
          role="log"
        >
          <div className={styles.chatNotice}>Loading Chat...</div>
        </div>
      ) : (
        <ChatTranscript
          key={transcriptVisit}
          atBottom={atBottom}
          firstItemIndex={firstItemIndex}
          historyExhausted={historyExhausted}
          loadingOlderHistory={loadingOlderHistory}
          messages={messages}
          onAtBottomChange={updateAtBottomState}
          onLoadOlder={() => void loadOlderHistory()}
          realtimeState={realtimeState}
          submissions={sending.submissions}
          onRetry={(submission) => void sending.send(submission)}
          retryDisabled={sendDisabled}
        />
      )}
      <p
        aria-atomic="true"
        aria-live={isChatVisible && atBottom ? 'polite' : 'off'}
        className={styles.chatAnnouncement}
        role="status"
      >
        {announcement && <span key={announcement.id}>{announcement.text}</span>}
      </p>
      <div
        aria-live={isChatVisible ? 'polite' : 'off'}
        aria-atomic="true"
        className={styles.chatError}
      >
        {unavailable ? (
          <p>Chat is unavailable.</p>
        ) : (
          (realtimeState !== 'connected' || delayed) && (
            <p>
              Reconnecting{delayed ? '. Message delivery is delayed.' : '...'}
            </p>
          )
        )}
        {(sending.error || error) && <p>{sending.error || error}</p>}
        {sending.remainingSeconds > 0 && (
          <p>Try again in {sending.remainingSeconds} seconds.</p>
        )}
      </div>
      <form
        className={styles.chatComposer}
        onSubmit={(event) => {
          event.preventDefault()
          if (!composingRef.current) void sending.send()
        }}
      >
        <input
          aria-label="Chat message"
          autoComplete="off"
          ref={composerRef}
          disabled={loading || accessDenied || unavailable}
          onChange={(event) => sending.setDraft(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (
              event.key === 'Enter' &&
              (composingRef.current ||
                event.nativeEvent.isComposing ||
                event.keyCode === 229)
            )
              event.preventDefault()
          }}
          onKeyUp={(event) => event.stopPropagation()}
          placeholder="Send a message"
          value={sending.draft}
        />
        <button
          aria-label="Send"
          disabled={sendDisabled || !sending.draft.trim()}
          type="submit"
        >
          <Send aria-hidden="true" />
        </button>
      </form>
    </>
  )
}

export function ChatPanel({
  channelSlug,
  open = true,
  focusComposer = false,
  closeButtonRef,
  narrowLayout,
  onClose,
}: ChatPanelProps) {
  const endpoint = `/api/channels/${encodeURIComponent(channelSlug)}/chat/messages`

  return (
    <ChatFrame
      closeButtonRef={closeButtonRef}
      label="Chat"
      open={open}
      focusComposer={focusComposer}
      narrowLayout={narrowLayout}
      onClose={onClose}
    >
      {(isChatVisible, explicitlyOpened) => (
        <ChatPanelContent
          channelSlug={channelSlug}
          endpoint={endpoint}
          isChatVisible={isChatVisible}
          focusComposer={explicitlyOpened}
          key={channelSlug}
        />
      )}
    </ChatFrame>
  )
}
