'use client'

import { Send } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { ChatFrame } from '@/components/chat-frame'
import { ChatMessage } from '@/components/chat-message'
import styles from '@/components/channel-viewer.module.css'
import type { PublicChatMessage } from '@/lib/chat-types'

interface ChatPanelProps {
  channelSlug: string
  closeButtonRef?: (element: HTMLButtonElement | null) => void
  narrowLayout: boolean
  onClose: () => void
}

interface ChatPanelContentProps {
  active: boolean
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

function ChatPanelContent({ active, endpoint }: ChatPanelContentProps) {
  const [messages, setMessages] = useState<PublicChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        setMessages(result.messages ?? [])
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
  }, [active, endpoint])

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
      setMessages((current) =>
        current.some(({ id }) => id === acceptedMessage.id)
          ? current
          : [...current, acceptedMessage],
      )
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
      <ol aria-label="Chat messages" className={styles.chatTranscript} role="log">
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
      {(active) => <ChatPanelContent active={active} endpoint={endpoint} />}
    </ChatFrame>
  )
}
