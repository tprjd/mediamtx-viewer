'use client'

import { RadioTower } from 'lucide-react'
import Link from 'next/link'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import styles from './home-dashboard.module.css'

import { ChannelNavigation } from '@/components/channel-navigation'
import { StatusBadge } from '@/components/status-badge'
import { useLiveRailPreference } from '@/components/use-live-rail-preference'
import { ViewerCount } from '@/components/viewer-count'
import { useChannelEvents } from '@/hooks/use-channel-events'
import {
  buildHomeDashboardModel,
  newlyLiveChannelNames,
} from '@/lib/home-dashboard'
import type { PublicChannel } from '@/lib/types'

interface HomeDashboardProps {
  initialChannels: PublicChannel[]
  capabilities: {
    isAdmin: boolean
  }
}

function ChannelCard({ channel }: { channel: PublicChannel }) {
  const initial = channel.title.trim().charAt(0).toUpperCase() || '•'
  const ownerInitials =
    channel.ownerName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '•'
  const live = channel.status.live

  return (
    <Link
      aria-label={`Watch ${channel.title} by ${channel.ownerName}, ${channel.status.state}`}
      className={`${styles.channelCard}${live ? '' : ` ${styles.isOffline}`}`}
      href={`/watch/${encodeURIComponent(channel.slug)}`}
      style={{ '--accent': channel.accentColor } as CSSProperties}
    >
      <div className={styles.cardMedia}>
        {channel.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" src={channel.poster} />
        ) : (
          <span aria-hidden="true">{initial}</span>
        )}
      </div>
      <div className={styles.cardDetails}>
        <span className={styles.ownerInitials} aria-hidden="true">
          {ownerInitials}
        </span>
        <div className={styles.cardCopy}>
          <h3 className={styles.cardTitle}>{channel.title}</h3>
          <p className={styles.cardOwner}>{channel.ownerName}</p>
          <div className={styles.cardStatus}>
            <StatusBadge
              compact={channel.status.state !== 'unavailable'}
              state={channel.status.state}
            />
            {live && channel.status.viewerCount === null ? (
              <span className={styles.viewerUnavailable}>
                Viewers unavailable
              </span>
            ) : (
              <ViewerCount
                compact
                count={channel.status.viewerCount}
                live={live}
              />
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}

export function HomeDashboard({
  initialChannels,
  capabilities,
}: HomeDashboardProps) {
  const { channels, statusDelayed: eventStatusDelayed } =
    useChannelEvents(initialChannels)
  const [announcement, setAnnouncement] = useState('')
  const previousChannels = useRef(initialChannels)
  const model = useMemo(() => buildHomeDashboardModel(channels), [channels])
  const statusDelayed = model.statusUnavailable || eventStatusDelayed
  const { effectivePreference } = useLiveRailPreference()
  const hasChannels =
    model.liveChannels.length + model.offlineChannels.length > 0

  useEffect(() => {
    const newlyLive = newlyLiveChannelNames(previousChannels.current, channels)
    previousChannels.current = channels
    if (newlyLive.length > 0) {
      setAnnouncement(
        `${newlyLive.join(', ')} ${newlyLive.length === 1 ? 'is' : 'are'} live now.`,
      )
    }
  }, [channels])

  return (
    <main
      className={`${styles.homeLayout}${effectivePreference === 'collapsed' ? ` ${styles.railCollapsed}` : ''}`}
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <ChannelNavigation channels={channels} />

      <div className={styles.homeContent}>
        <div className={styles.directoryHeading}>
          <h1>Channels</h1>
          <p aria-label="Channel status" role="status">
            {statusDelayed
              ? 'Channel status updates are delayed.'
              : 'Channel status updates automatically.'}
          </p>
        </div>

        {hasChannels ? (
          <div className={styles.directorySections}>
            <section
              className={styles.channelSection}
              aria-labelledby="live-channels-heading"
            >
              <div className={styles.sectionHeading}>
                <h2 id="live-channels-heading">Live Channels</h2>
                <span>{model.liveCount}</span>
              </div>
              {model.liveChannels.length > 0 ? (
                <div className={styles.channelGrid}>
                  {model.liveChannels.map((channel) => (
                    <ChannelCard channel={channel} key={channel.slug} />
                  ))}
                </div>
              ) : (
                <p className={styles.emptySection}>No Channels are live.</p>
              )}
            </section>

            <section
              className={styles.channelSection}
              aria-labelledby="offline-channels-heading"
            >
              <div className={styles.sectionHeading}>
                <h2 id="offline-channels-heading">Offline Channels</h2>
                <span>{model.offlineChannels.length}</span>
              </div>
              <div className={styles.channelGrid}>
                {model.offlineChannels.map((channel) => (
                  <ChannelCard channel={channel} key={channel.slug} />
                ))}
              </div>
            </section>
          </div>
        ) : (
          <section className={styles.channelSection} aria-label="Channel directory">
            <div className={styles.noChannelsState}>
              <RadioTower aria-hidden="true" />
              <h3>No channels yet.</h3>
              <p>An administrator can grant streaming access to an active account.</p>
              {capabilities.isAdmin && (
                <Link href="/admin/users">Grant streaming access</Link>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
