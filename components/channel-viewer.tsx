'use client'

import { Clock3, MessageSquare, UserRound } from 'lucide-react'
import { useState } from 'react'
import styles from './channel-viewer.module.css'

import { ChannelNavigation } from '@/components/channel-navigation'
import { LivePlayer } from '@/components/live-player'
import { ShareButton } from '@/components/share-button'
import { StatusBadge } from '@/components/status-badge'
import { useLiveRailPreference } from '@/components/use-live-rail-preference'
import { ViewerCount } from '@/components/viewer-count'
import { useChannelEvents } from '@/hooks/use-channel-events'
import type { PublicChannel } from '@/lib/types'

interface ChannelViewerProps {
  channel: PublicChannel
  channels?: PublicChannel[]
  viewerId?: string
}

export function ChannelViewer({ channel, channels = [channel], viewerId }: ChannelViewerProps) {
  const [playbackControlsTarget, setPlaybackControlsTarget] =
    useState<HTMLDivElement | null>(null)
  const [playbackStatsTarget, setPlaybackStatsTarget] =
    useState<HTMLDivElement | null>(null)
  const { effectivePreference } = useLiveRailPreference()
  const { channels: eventChannels } = useChannelEvents(channels)
  const currentChannel =
    eventChannels.find((item) => item.slug === channel.slug) ?? channel
  const status = currentChannel.status
  const railCollapsed = effectivePreference === 'collapsed'

  return (
    <main className={styles.watchLayout}>
      <div
        className={`${styles.watchColumns}${status.live ? '' : ` ${styles.withoutChat}`}${railCollapsed ? ` ${styles.railCollapsed}` : ''}`}
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
          <section className={styles.watchDetails} aria-label="Channel information">
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
              <p className={styles.watchDescription}>{currentChannel.description}</p>
            )}
            <div className={styles.watchPlaybackRow}>
              <div ref={setPlaybackControlsTarget} className={styles.playbackControlsTarget} />
              <ShareButton title={currentChannel.title} />
              <div ref={setPlaybackStatsTarget} className={styles.playbackStatsTarget} />
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
        {status.live && (
          <aside className={styles.chatPlaceholder} aria-label="Chat placeholder">
            <div className={styles.chatHeading}>
              <MessageSquare className="size-4" aria-hidden="true" />
              <strong>Chat</strong>
            </div>
            <div className={styles.chatEmptyState}>
              <MessageSquare className="size-7" aria-hidden="true" />
              <p>Chat is coming soon</p>
              <span>Conversation will be available here in a future update.</span>
            </div>
            <input aria-label="Chat message" disabled placeholder="Chat is unavailable" />
          </aside>
        )}
      </div>
    </main>
  )
}
