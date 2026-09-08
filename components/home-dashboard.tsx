'use client'

import {
  RadioTower,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import Link from 'next/link'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import styles from './home-dashboard.module.css'

import { StatusBadge } from '@/components/status-badge'
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
    hasOwnedChannel: boolean
    isAdmin: boolean
  }
}

function ChannelCard({ channel }: { channel: PublicChannel }) {
  const initial = channel.title.trim().charAt(0).toUpperCase() || '•'
  const live = channel.status.live

  return (
    <Link
      aria-label={`Watch ${channel.title} by ${channel.ownerName}, ${channel.status.state}`}
      className={`${styles.channelCard}${live ? ` ${styles.isLive}` : ''}`}
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
        <div className={styles.cardStatusRow}>
          <StatusBadge compact state={channel.status.state} />
          <ViewerCount count={channel.status.viewerCount} live={live} />
        </div>
        <h3 className={styles.cardTitle}>{channel.title}</h3>
        <p className="channel-owner-name">{channel.ownerName}</p>
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
    <main className={styles.homeLayout}>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <section className={styles.homeIntro} aria-labelledby="home-title">
        <div className={styles.homeIntroCopy}>
          <p className="eyebrow">Private streams</p>
          <h1 id="home-title">What are we watching?</h1>
        </div>
        <div className={styles.homeIntroSide}>
          <p
            className={`${styles.liveSummary} ${
              statusDelayed
                ? styles.isDelayed
                : model.liveCount > 0
                  ? styles.isLive
                  : ''
            }`}
            aria-label={
              statusDelayed
                ? 'Channel status updates are delayed'
                : `${model.liveCount} ${model.liveCount === 1 ? 'channel' : 'channels'} live now`
            }
          >
            <span aria-hidden="true" />
            {statusDelayed
              ? 'Status delayed'
              : `${model.liveCount} live now`}
          </p>
          {(capabilities.hasOwnedChannel || capabilities.isAdmin) && (
            <nav className={styles.homeShortcuts} aria-label="Channel shortcuts">
              {capabilities.hasOwnedChannel && (
                <Link href="/account/channel">
                  <SlidersHorizontal className="size-4" aria-hidden="true" />
                  My channel
                </Link>
              )}
              {capabilities.isAdmin && (
                <Link href="/admin/users">
                  <ShieldCheck className="size-4" aria-hidden="true" />
                  Manage users
                </Link>
              )}
            </nav>
          )}
        </div>
      </section>

      <section className={styles.channelSection} aria-labelledby="channels-heading">
        <div className={styles.dashboardSectionHeading}>
          <div>
            <p className="eyebrow">The group</p>
            <h2 id="channels-heading">All channels</h2>
          </div>
          <p>
            {statusDelayed
              ? 'Waiting for a fresh status check.'
              : 'Status updates automatically.'}
          </p>
        </div>
        {model.allChannels.length > 0 ? (
          <div className={styles.channelGrid}>
            {model.allChannels.map((channel) => (
              <ChannelCard channel={channel} key={channel.slug} />
            ))}
          </div>
        ) : (
          <div className={styles.noChannelsState}>
            <RadioTower aria-hidden="true" />
            <h3>No channels yet.</h3>
            <p>An administrator can grant streaming access to an active account.</p>
            {capabilities.isAdmin && (
              <Link href="/admin/users">Grant streaming access</Link>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
