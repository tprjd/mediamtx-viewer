'use client'

import * as Collapsible from '@radix-ui/react-collapsible'
import { ChevronDown, Clock3, MessageSquare, Settings2, UserRound, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import styles from './channel-viewer.module.css'

import { ChannelNavigation } from '@/components/channel-navigation'
import { LivePlayer } from '@/components/live-player'
import { ShareButton } from '@/components/share-button'
import { StatusBadge } from '@/components/status-badge'
import { useChatPreference } from '@/components/use-chat-preference'
import { useLiveRailPreference } from '@/components/use-live-rail-preference'
import { useNarrowWatchLayout } from '@/components/use-narrow-watch-layout'
import { ViewerCount } from '@/components/viewer-count'
import { useChannelEvents } from '@/hooks/use-channel-events'
import type { PublicChannel } from '@/lib/types'

interface ChannelViewerProps {
  channel: PublicChannel
  channels?: PublicChannel[]
  viewerId?: string
}

interface ChatPlaceholderProps {
  closeButtonRef?: (element: HTMLButtonElement | null) => void
  narrowLayout: boolean
  onClose: () => void
}

interface PlaybackSettingsProps {
  controlsTarget: (target: HTMLDivElement | null) => void
  statsTarget: (target: HTMLDivElement | null) => void
  tracks: readonly string[]
}

function noopSubscribe(): () => void {
  return () => {}
}

function getChatHeaderTarget(): HTMLElement | null {
  return document.getElementById('chat-restore-target')
}

function ChatRestoreControl({
  buttonRef,
  onOpen,
}: {
  buttonRef?: (element: HTMLButtonElement | null) => void
  onOpen: () => void
}) {
  const target = useSyncExternalStore(
    noopSubscribe,
    getChatHeaderTarget,
    () => null,
  )

  if (!target) return null

  return createPortal(
    <button
      aria-label="Open Chat"
      className={styles.chatRestore}
      onClick={onOpen}
      ref={buttonRef}
      title="Open Chat"
      type="button"
    >
      <MessageSquare aria-hidden="true" />
    </button>,
    target,
  )
}

function ChatPlaceholder({
  closeButtonRef,
  narrowLayout,
  onClose,
}: ChatPlaceholderProps) {
  const [mobileExpanded, setMobileExpanded] = useState(false)
  const contentId = useId()
  const isOpen = !narrowLayout || mobileExpanded

  return (
    <Collapsible.Root
      asChild
      open={isOpen}
      onOpenChange={setMobileExpanded}
    >
      <aside className={styles.chatPlaceholder} aria-label="Chat placeholder">
        <div className={styles.chatHeading}>
          <div className={styles.chatTitle}>
            <MessageSquare aria-hidden="true" />
            <strong>Chat</strong>
          </div>
          <div className={styles.chatActions}>
            <Collapsible.Trigger
              asChild
              aria-controls={contentId}
              className={styles.chatToggle}
            >
              <button type="button">
                <MessageSquare aria-hidden="true" />
                <span>Chat</span>
              </button>
            </Collapsible.Trigger>
            <button
              aria-label="Close Chat"
              className={styles.chatClose}
              onClick={onClose}
              ref={closeButtonRef}
              title="Close Chat"
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        </div>
        <Collapsible.Content className={styles.chatContent} id={contentId}>
          <div className={styles.chatEmptyState}>
            <MessageSquare className="size-7" aria-hidden="true" />
            <p>Chat is coming soon</p>
            <span>Conversation will be available here in a future update.</span>
          </div>
          <input
            aria-label="Chat message"
            disabled
            placeholder="Chat is unavailable"
          />
        </Collapsible.Content>
      </aside>
    </Collapsible.Root>
  )
}

function PlaybackSettings({
  controlsTarget,
  statsTarget,
  tracks,
}: PlaybackSettingsProps) {
  const [open, setOpen] = useState(false)
  const contentId = useId()

  return (
    <Collapsible.Root
      className={styles.playbackSettings}
      open={open}
      onOpenChange={setOpen}
    >
      <div className={styles.playbackSettingsHeader}>
        <div className={styles.playbackSettingsLabel}>
          <Settings2 aria-hidden="true" />
          <div>
            <strong>Playback settings</strong>
            <span>Modes, tracks, and live diagnostics</span>
          </div>
        </div>
        <Collapsible.Trigger asChild>
          <button
            aria-controls={contentId}
            className={styles.playbackSettingsTrigger}
            type="button"
          >
            <span>
              {open ? 'Hide playback settings' : 'Show playback settings'}
            </span>
            <ChevronDown aria-hidden="true" />
          </button>
        </Collapsible.Trigger>
      </div>
      <Collapsible.Content
        className={styles.playbackSettingsContent}
        id={contentId}
      >
        <div ref={controlsTarget} className={styles.playbackControlsTarget} />
        <div
          aria-label="Live playback metadata"
          className={styles.watchMetadata}
        >
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="size-3.5" aria-hidden="true" />
            Live playback
          </span>
          {tracks.length > 0 && <span>{tracks.join(' · ')}</span>}
        </div>
        <div ref={statsTarget} className={styles.playbackStatsTarget} />
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

export function ChannelViewer({
  channel,
  channels = [channel],
  viewerId,
}: ChannelViewerProps) {
  const [playbackControlsTarget, setPlaybackControlsTarget] =
    useState<HTMLDivElement | null>(null)
  const [playbackStatsTarget, setPlaybackStatsTarget] =
    useState<HTMLDivElement | null>(null)
  const [theaterState, setTheaterState] = useState({
    channelSlug: channel.slug,
    enabled: false,
  })
  const chatRestoreRef = useRef<HTMLButtonElement | null>(null)
  const theaterChatCloseRef = useRef<HTMLButtonElement | null>(null)
  const theaterChatRestoreRef = useRef<HTMLButtonElement | null>(null)
  const previousChatOpenRef = useRef(false)
  const { effectivePreference } = useLiveRailPreference()
  const { preference: chatPreference, setPreference: setChatPreference } =
    useChatPreference()
  const narrowLayout = useNarrowWatchLayout()
  const { channels: eventChannels } = useChannelEvents(channels)
  const currentChannel =
    eventChannels.find((item) => item.slug === channel.slug) ?? channel
  const status = currentChannel.status
  const railCollapsed = effectivePreference === 'collapsed'
  const chatOpen = status.live && chatPreference === 'open'
  const theaterMode =
    theaterState.channelSlug === channel.slug && theaterState.enabled
  const setTheaterMode = useCallback(
    (enabled: boolean) => {
      setTheaterState({ channelSlug: channel.slug, enabled })
    },
    [channel.slug],
  )

  useEffect(() => {
    if (!theaterMode) return

    const body = document.body
    const previousTheaterMode = body.getAttribute('data-theater-mode')
    const previousOverflow = body.style.overflow
    body.setAttribute('data-theater-mode', 'true')
    body.style.overflow = 'hidden'

    return () => {
      if (previousTheaterMode === null) {
        body.removeAttribute('data-theater-mode')
      } else {
        body.setAttribute('data-theater-mode', previousTheaterMode)
      }
      body.style.overflow = previousOverflow
    }
  }, [theaterMode])

  useEffect(() => {
    const wasChatOpen = previousChatOpenRef.current

    if (theaterMode && wasChatOpen && !chatOpen) {
      theaterChatRestoreRef.current?.focus()
    } else if (theaterMode && !wasChatOpen && chatOpen) {
      theaterChatCloseRef.current?.focus()
    } else if (!theaterMode && wasChatOpen && !chatOpen) {
      chatRestoreRef.current?.focus()
    }

    previousChatOpenRef.current = chatOpen
  }, [chatOpen, theaterMode])

  return (
    <>
      {status.live && !chatOpen && !theaterMode && (
        <ChatRestoreControl
          buttonRef={(element) => {
            chatRestoreRef.current = element
          }}
          onOpen={() => setChatPreference('open')}
        />
      )}
      <main
        className={`${styles.watchLayout}${theaterMode ? ` ${styles.theaterLayout}` : ''}`}
        data-theater-mode={theaterMode ? 'true' : undefined}
        data-watch-page
      >
        <div
          className={`${styles.watchColumns}${chatOpen ? '' : ` ${styles.withoutChat}`}${railCollapsed ? ` ${styles.railCollapsed}` : ''}${theaterMode ? ` ${styles.theaterColumns}` : ''}${theaterMode && !chatOpen ? ` ${styles.theaterColumnsWithoutChat}` : ''}`}
        >
          <ChannelNavigation
            channels={eventChannels}
            watchedSlug={currentChannel.slug}
          />
          <div
            className={`${styles.watchMainColumn}${theaterMode ? ` ${styles.theaterMainColumn}` : ''}`}
          >
            <div className={styles.watchPlayerWrap}>
              <LivePlayer
                chatOpen={chatOpen}
                channel={currentChannel}
                onOpenChat={
                  status.live ? () => setChatPreference('open') : undefined
                }
                onTheaterModeChange={setTheaterMode}
                playbackControlsTarget={playbackControlsTarget}
                playbackStatsTarget={playbackStatsTarget}
                theaterChatRestoreRef={(element) => {
                  theaterChatRestoreRef.current = element
                }}
                theaterMode={theaterMode}
                viewerId={viewerId}
              />
            </div>
            <section
              className={styles.watchDetails}
              aria-label="Channel information"
            >
              <div className={styles.watchIdentity}>
                <div className={styles.watchTitleRow}>
                  <h1>{currentChannel.title}</h1>
                  <ShareButton title={currentChannel.title} />
                </div>
                <div className={styles.watchInfoRow}>
                  <StatusBadge state={status.state} />
                  <ViewerCount count={status.viewerCount} live={status.live} />
                  <span className={styles.channelOwner}>
                    <UserRound className="size-3.5" aria-hidden="true" />
                    {currentChannel.ownerName}
                  </span>
                </div>
              </div>
              {currentChannel.description && (
                <p className={styles.watchDescription}>
                  {currentChannel.description}
                </p>
              )}
              {status.live && (
                <PlaybackSettings
                  controlsTarget={setPlaybackControlsTarget}
                  statsTarget={setPlaybackStatsTarget}
                  tracks={status.tracks}
                />
              )}
            </section>
          </div>
          {chatOpen && (
            <ChatPlaceholder
              closeButtonRef={(element) => {
                theaterChatCloseRef.current = element
              }}
              narrowLayout={narrowLayout && !theaterMode}
              onClose={() => setChatPreference('closed')}
            />
          )}
        </div>
      </main>
    </>
  )
}
