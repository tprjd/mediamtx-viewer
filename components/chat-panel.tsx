'use client'

import { Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ChatRestrictionsPanel } from '@/components/chat-restrictions-panel'
import { ChatClearHistory } from '@/components/chat-clear-history'
import { ChatFrame } from '@/components/chat-frame'
import { ChatSettings, useChatTimestamps } from '@/components/chat-settings'
import { ChatTranscript } from '@/components/chat-transcript'
import { useChatRoom } from '@/components/use-chat-room'
import styles from '@/components/channel-viewer.module.css'

interface ChatPanelProps {
  channelSlug: string
  open?: boolean
  focusComposer?: boolean
  closeButtonRef?: (element: HTMLButtonElement | null) => void
  narrowLayout: boolean
  onClose: () => void
}

interface ChatPanelContentProps {
  showTimestamps: boolean
  moderationTarget: HTMLDivElement | null
  isChatVisible: boolean
  channelSlug: string
  focusComposer: boolean
}

function ChatPanelContent({
  showTimestamps,
  moderationTarget,
  channelSlug,
  isChatVisible,
  focusComposer,
}: ChatPanelContentProps) {
  const {
    loading,
    transcriptKey,
    transcript,
    composer,
    moderation,
    status,
    announcement,
  } = useChatRoom(channelSlug, isChatVisible)
  const composerRef = useRef<HTMLInputElement | null>(null)
  const composingRef = useRef(false)

  useEffect(() => {
    if (focusComposer && composer.canFocus) composerRef.current?.focus()
  }, [focusComposer, composer.canFocus])

  return (
    <>
      {moderation.role &&
        moderationTarget &&
        createPortal(
          <>
            <ChatRestrictionsPanel channelSlug={channelSlug} />
            {moderation.role === 'admin' && (
              <ChatClearHistory channelSlug={channelSlug} onCleared={moderation.onCleared} />
            )}
          </>,
          moderationTarget,
        )}
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
          {...transcript}
          key={transcriptKey}
          showTimestamps={showTimestamps}
        />
      )}
      <p
        aria-atomic="true"
        aria-live={isChatVisible && transcript.atBottom ? 'polite' : 'off'}
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
        {status.unavailable ? (
          <p>Chat is unavailable.</p>
        ) : (
          status.reconnecting && (
            <p>
              Reconnecting{status.delayed ? '. Message delivery is delayed.' : '...'}
            </p>
          )
        )}
        {status.error && <p>{status.error}</p>}
        {status.retrySeconds > 0 && (
          <p>Try again in {status.retrySeconds} seconds.</p>
        )}
      </div>
      {status.restriction && (
        <p
          role="status"
          aria-label={
            status.restriction.expiresAt === null ? 'Chat ban' : 'Chat timeout'
          }
          aria-live="off"
          className={styles.chatError}
        >
          {status.restriction.expiresAt === null ? (
            <>
              Chat ban: {status.restriction.category}. Indefinite, until a Chat
              moderator lifts it.
            </>
          ) : (
            <>
              Chat timeout: {status.restriction.category}.{' '}
              {Math.floor(status.restrictionSeconds / 3600)}h{' '}
              {Math.floor((status.restrictionSeconds % 3600) / 60)}m{' '}
              {status.restrictionSeconds % 60}s remaining.
            </>
          )}
        </p>
      )}
      {status.storageLimited && (
        <p role="status" className={styles.chatError}>Chat storage limit reached. Sending is paused.</p>
      )}
      {status.restrictionCheckFailed && (
        <p role="alert" className={styles.chatError}>
          Could not check Chat sending access. Retrying...
        </p>
      )}
      <form
        className={styles.chatComposer}
        onSubmit={(event) => {
          event.preventDefault()
          if (!composingRef.current) composer.send()
        }}
      >
        <div className={styles.chatInputRow}>
          <input
            aria-label="Chat message"
            autoComplete="off"
            ref={composerRef}
            disabled={composer.disabled}
            onChange={(event) => composer.setDraft(event.target.value)}
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
            value={composer.draft}
          />
          <button
            aria-label="Send"
            disabled={composer.sendDisabled}
            type="submit"
          >
            <Send aria-hidden="true" />
          </button>
        </div>
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
  const showTimestamps = useChatTimestamps()
  const [moderationTarget, setModerationTarget] =
    useState<HTMLDivElement | null>(null)

  return (
    <ChatFrame
      headerActions={<ChatSettings showTimestamps={showTimestamps} />}
      moderationTargetRef={setModerationTarget}
      closeButtonRef={closeButtonRef}
      label="Chat"
      open={open}
      focusComposer={focusComposer}
      narrowLayout={narrowLayout}
      onClose={onClose}
    >
      {(isChatVisible, explicitlyOpened) => (
        <ChatPanelContent
          showTimestamps={showTimestamps}
          moderationTarget={moderationTarget}
          channelSlug={channelSlug}
          isChatVisible={isChatVisible}
          focusComposer={explicitlyOpened}
          key={channelSlug}
        />
      )}
    </ChatFrame>
  )
}
