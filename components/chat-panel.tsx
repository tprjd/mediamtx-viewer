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
import { ChatMessage } from '@/components/chat-message'
import { useChatRealtime } from '@/components/use-chat-realtime'
import styles from '@/components/channel-viewer.module.css'
import {
  firstChatSequenceGap,
  mergeChatMessages,
} from '@/lib/chat-client-state'
import type { PublicChatMessage } from '@/lib/chat-types'

interface ChatPanelProps {
  channelSlug: string
  closeButtonRef?: (element: HTMLButtonElement | null) => void
  narrowLayout: boolean
  onClose: () => void
}

interface ChatPanelContentProps {
  active: boolean
  channelSlug: string
  endpoint: string
}

interface HistoryResponse {
  messages?: PublicChatMessage[]
  error?: string
}

interface SendResponse {
  message?: PublicChatMessage
  error?: string
}

function ChatPanelContent({
  active,
  channelSlug,
  endpoint,
}: ChatPanelContentProps) {
  const [messages, setMessages] = useState<PublicChatMessage[]>([])
  const messagesRef = useRef<PublicChatMessage[]>([])
  const reconciliationRef = useRef<Promise<void> | null>(null)
  const pendingReconciliationRef = useRef<number | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mergeMessages = useCallback((incoming: PublicChatMessage[]) => {
    const merged = mergeChatMessages(messagesRef.current, incoming)
    messagesRef.current = merged
    setMessages(merged)
    return merged
  }, [])

  const reconcile = useCallback((afterSequence?: number) => {
    const requestedAfter =
      afterSequence ?? messagesRef.current.at(-1)?.sequence ?? 0
    pendingReconciliationRef.current =
      pendingReconciliationRef.current === null
        ? requestedAfter
        : Math.min(pendingReconciliationRef.current, requestedAfter)
    if (reconciliationRef.current) return
    const work = (async () => {
      while (pendingReconciliationRef.current !== null) {
        let after = pendingReconciliationRef.current
        pendingReconciliationRef.current = null
        let hasMore = true
        while (hasMore) {
          const response = await fetch(`${endpoint}?after=${after}`, {
            cache: 'no-store',
          })
          const result = (await response.json()) as HistoryResponse & {
            hasMore?: boolean
          }
          if (!response.ok) {
            throw new Error(result.error ?? 'Could not reconcile Chat.')
          }
          const incoming = result.messages ?? []
          mergeMessages(incoming)
          after = incoming.at(-1)?.sequence ?? after
          hasMore = result.hasMore === true && incoming.length > 0
        }
        const remainingGap = firstChatSequenceGap(messagesRef.current)
        if (remainingGap !== null) pendingReconciliationRef.current = remainingGap
      }
    })()
      .catch((reconcileError: unknown) => {
        setError(
          reconcileError instanceof Error
            ? reconcileError.message
            : 'Could not reconcile Chat.',
        )
      })
      .finally(() => {
        reconciliationRef.current = null
      })
    reconciliationRef.current = work
  }, [endpoint, mergeMessages])

  const receiveMessage = useCallback(
    (message: PublicChatMessage) => {
      const lastSequence = messagesRef.current.at(-1)?.sequence
      mergeMessages([message])
      if (
        lastSequence !== undefined &&
        message.sequence > lastSequence + 1
      ) {
        reconcile(lastSequence)
      }
    },
    [mergeMessages, reconcile],
  )

  const realtimeState = useChatRealtime({
    active,
    channelSlug,
    onMessage: receiveMessage,
    onRecoveryFailed: reconcile,
  })

  useEffect(() => {
    if (!active) return

    const controller = new AbortController()
    void fetch(endpoint, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as HistoryResponse
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true)
        }
        if (!response.ok) throw new Error(result.error ?? 'Could not load Chat.')
        const merged = mergeMessages(result.messages ?? [])
        const gap = firstChatSequenceGap(merged)
        if (gap !== null) reconcile(gap)
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return
        setError(
          loadError instanceof Error ? loadError.message : 'Could not load Chat.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [active, endpoint, mergeMessages, reconcile])

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!draft.trim() || sending) return

    setSending(true)
    setError(null)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      })
      const result = (await response.json()) as SendResponse
      if (response.status === 401 || response.status === 403) {
        setAccessDenied(true)
      }
      if (!response.ok || !result.message) {
        throw new Error(result.error ?? 'Could not send the message.')
      }
      const acceptedMessage = result.message
      mergeMessages([acceptedMessage])
      setDraft('')
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : 'Could not send the message.',
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <ol
        aria-label="Chat messages"
        className={styles.chatTranscript}
        data-realtime-state={realtimeState}
        role="log"
      >
        {loading && <li className={styles.chatNotice}>Loading Chat...</li>}
        {!loading && messages.length === 0 && !error && (
          <li className={styles.chatNotice}>No messages yet.</li>
        )}
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
      </ol>
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
      {(active) => (
        <ChatPanelContent
          active={active}
          channelSlug={channelSlug}
          endpoint={endpoint}
          key={channelSlug}
        />
      )}
    </ChatFrame>
  )
}
