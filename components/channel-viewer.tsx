'use client'

import * as Collapsible from '@radix-ui/react-collapsible'
import { Clock3, MessageSquare, UserRound, X } from 'lucide-react'
import { useId, useState, useSyncExternalStore } from 'react'
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
  narrowLayout: boolean
  onClose: () => void
}

function noopSubscribe(): () => void {
  return () => {}
}

function getChatHeaderTarget(): HTMLElement | null {
  return document.getElementById('chat-restore-target')
}

function ChatRestoreControl({ onOpen }: { onOpen: () => void }) {
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
      title="Open Chat"
      type="button"
    >
      <MessageSquare aria-hidden="true" />
    </button>,
    target,
  )
}

function ChatPlaceholder({ narrowLayout, onClose }: ChatPlaceholderProps) {
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

export function ChannelViewer({
  channel,
  channels = [channel],
  viewerId,
}: ChannelViewerProps) {
  const [playbackControlsTarget, setPlaybackControlsTarget] =
    useState<HTMLDivElement | null>(null)
  const [playbackStatsTarget, setPlaybackStatsTarget] =
    useState<HTMLDivElement | null>(null)
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

  return (
    <>
      {status.live && !chatOpen && (
        <ChatRestoreControl onOpen={() => setChatPreference('open')} />
      )}
      <main className={styles.watchLayout}>
        <div
          className={`${styles.watchColumns}${chatOpen ? '' : ` ${styles.withoutChat}`}${railCollapsed ? ` ${styles.railCollapsed}` : ''}`}
        >
          <ChannelNavigation
            channels={eventChannels}
            watchedSlug={currentChannel.slug}
          />
          <div className={styles.watchMainColumn}>
            <div className={styles.watchPlayerWrap}>
              <LivePlayer
                channel={currentChannel}
                playbackControlsTarget={playbackControlsTarget}
                playbackStatsTarget={playbackStatsTarget}
                viewerId={viewerId}
              />
            </div>
            <section
              className={styles.watchDetails}
              aria-label="Channel information"
            >
              <div className={styles.watchInfoRow}>
                <StatusBadge state={status.state} />
                <ViewerCount count={status.viewerCount} live={status.live} />
                <h1>{currentChannel.title}</h1>
                <span className={styles.channelOwner}>
                  <UserRound className="size-3.5" aria-hidden="true" />
                  {currentChannel.ownerName}
                </span>
              </div>
              {currentChannel.description && (
                <p className={styles.watchDescription}>
                  {currentChannel.description}
                </p>
              )}
              <div className={styles.watchPlaybackRow}>
                <div
                  ref={setPlaybackControlsTarget}
                  className={styles.playbackControlsTarget}
                />
                <ShareButton title={currentChannel.title} />
                <div
                  ref={setPlaybackStatsTarget}
                  className={styles.playbackStatsTarget}
                />
              </div>
              <div className={styles.watchMetadata}>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="size-3.5" aria-hidden="true" />
                  Live playback
                </span>
                {status.tracks.length > 0 && (
                  <span>{status.tracks.join(' · ')}</span>
                )}
              </div>
            </section>
          </div>
          {chatOpen && (
            <ChatPlaceholder
              narrowLayout={narrowLayout}
              onClose={() => setChatPreference('closed')}
            />
          )}
        </div>
      </main>
    </>
  )
}
