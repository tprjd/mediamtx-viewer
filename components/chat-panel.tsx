'use client'

import { Send } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'

import { ChatFrame } from '@/components/chat-frame'
import {
  ChatTranscript,
  chatTranscriptEntryCount,
} from '@/components/chat-transcript'
import { useChatRealtime } from '@/components/use-chat-realtime'
import styles from '@/components/channel-viewer.module.css'
import {
  firstChatSequenceGap,
  mergeChatHistoryPages,
  mergeChatMessages,
} from '@/lib/chat-client-state'
import type { ChatHistoryPage, PublicChatMessage } from '@/lib/chat-types'

interface ChatPanelProps {
  channelSlug: string
  closeButtonRef?: (element: HTMLButtonElement | null) => void
  narrowLayout: boolean
  onClose: () => void
}

interface ChatPanelContentProps {
  isChatVisible: boolean
  channelSlug: string
  endpoint: string
}

interface HistoryResponse extends Partial<ChatHistoryPage> {
  error?: string
}

interface SendResponse {
  message?: PublicChatMessage
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
}: ChatPanelContentProps) {
  const [messages, setMessages] = useState<PublicChatMessage[]>([])
  const messagesRef = useRef<PublicChatMessage[]>([])
  const reconciliationRef = useRef<Promise<void> | null>(null)
  const pendingReconciliationRef = useRef<number | null>(null)
  const requestGenerationRef = useRef(0)
  const wasChatVisibleRef = useRef(isChatVisible)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [firstItemIndex, setFirstItemIndex] = useState(
    INITIAL_FIRST_ITEM_INDEX,
  )
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
    messagesRef.current = []
    reconciliationRef.current = null
    pendingReconciliationRef.current = null
    historyCursorRef.current = null
    updateOlderHistoryLoading(false)
    updateHistoryAvailability(false)
    setHistoryExhausted(false)
    updateAtBottomState(true)
    setMessages([])
    setLoading(true)
    setSending(false)
    setAccessDenied(false)
    setError(null)
    setFirstItemIndex(INITIAL_FIRST_ITEM_INDEX)
    setAnnouncement(null)
  }, [updateAtBottomState, updateHistoryAvailability, updateOlderHistoryLoading])

  const announceMessage = useCallback((message: PublicChatMessage) => {
    announcementIdRef.current += 1
    setAnnouncement({
      id: announcementIdRef.current,
      text: `${message.profileName}: ${message.content}`,
    })
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
            const result = (await response.json()) as HistoryResponse
            if (requestGeneration !== requestGenerationRef.current) return
            if (!response.ok) {
              throw new Error(result.error ?? 'Could not reconcile Chat.')
            }
            const incoming = result.messages ?? []
            mergeMessages(incoming)
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
    [endpoint, mergeMessages],
  )

  const receiveMessage = useCallback(
    (message: PublicChatMessage) => {
      if (!isChatVisible) return
      const lastSequence = messagesRef.current.at(-1)?.sequence
      mergeAndAnnounceMessage(message)
      if (
        lastSequence !== undefined &&
        message.sequence > lastSequence + 1
      ) {
        reconcile(lastSequence)
      }
    },
    [isChatVisible, mergeAndAnnounceMessage, reconcile],
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
    void fetch(endpoint, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as HistoryResponse
        if (requestGeneration !== requestGenerationRef.current) return
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true)
        }
        if (!response.ok) throw new Error(result.error ?? 'Could not load Chat.')
        const { merged } = mergeMessages(result.messages ?? [])
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
  }, [applyHistoryPageMetadata, endpoint, isChatVisible, mergeMessages, reconcile])

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!draft.trim() || sending) return

    const requestGeneration = requestGenerationRef.current
    setSending(true)
    setError(null)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      })
      const result = (await response.json()) as SendResponse
      if (requestGeneration !== requestGenerationRef.current) return
      if (response.status === 401 || response.status === 403) {
        setAccessDenied(true)
      }
      if (!response.ok || !result.message) {
        throw new Error(result.error ?? 'Could not send the message.')
      }
      mergeAndAnnounceMessage(result.message)
      setDraft('')
    } catch (sendError) {
      if (requestGeneration !== requestGenerationRef.current) return
      setError(
        sendError instanceof Error
          ? sendError.message
          : 'Could not send the message.',
      )
    } finally {
      if (requestGeneration === requestGenerationRef.current) setSending(false)
    }
  }

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
          atBottom={atBottom}
          firstItemIndex={firstItemIndex}
          historyExhausted={historyExhausted}
          loadingOlderHistory={loadingOlderHistory}
          messages={messages}
          onAtBottomChange={updateAtBottomState}
          onLoadOlder={() => void loadOlderHistory()}
          realtimeState={realtimeState}
        />
      )}
      <p
        aria-atomic="true"
        aria-live={isChatVisible && atBottom ? 'polite' : 'off'}
        className={styles.chatAnnouncement}
        role="status"
      >
        {announcement && (
          <span key={announcement.id}>{announcement.text}</span>
        )}
      </p>
      {error && <p className={styles.chatError}>{error}</p>}
      <form className={styles.chatComposer} onSubmit={sendMessage}>
        <input
          aria-label="Chat message"
          autoComplete="off"
          disabled={loading || sending || accessDenied}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Send a message"
          value={draft}
        />
        <button
          aria-label="Send"
          disabled={loading || sending || accessDenied || !draft.trim()}
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
  closeButtonRef,
  narrowLayout,
  onClose,
}: ChatPanelProps) {
  const endpoint = `/api/channels/${encodeURIComponent(channelSlug)}/chat/messages`

  return (
    <ChatFrame
      closeButtonRef={closeButtonRef}
      label="Chat"
      narrowLayout={narrowLayout}
      onClose={onClose}
    >
      {(isChatVisible) => (
        <ChatPanelContent
          channelSlug={channelSlug}
          endpoint={endpoint}
          isChatVisible={isChatVisible}
          key={channelSlug}
        />
      )}
    </ChatFrame>
  )
}
