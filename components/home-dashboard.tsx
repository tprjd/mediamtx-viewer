'use client'

import {
  ArrowUpRight,
  RadioTower,
  ShieldCheck,
  SignalZero,
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

function FeaturedChannel({ channel }: { channel: PublicChannel }) {
  const initial = channel.title.trim().charAt(0).toUpperCase() || '•'

  return (
    <Link
      aria-label={`Watch ${channel.title} by ${channel.ownerName}, live`}
      className={styles.featuredChannel}
      href={`/watch/${encodeURIComponent(channel.slug)}`}
      style={{ '--accent': channel.accentColor } as CSSProperties}
    >
      <div className={styles.featuredArtwork}>
        {channel.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" src={channel.poster} />
        ) : (
          <span aria-hidden="true">{initial}</span>
        )}
        <div className={styles.featuredStatus}>
          <StatusBadge compact state={channel.status.state} />
          <ViewerCount
            compact
            count={channel.status.viewerCount}
            live={channel.status.live}
          />
        </div>
      </div>
      <div className={styles.featuredDetails}>
        <div className={styles.featuredCopy}>
          <h2>{channel.title}</h2>
          {channel.description && (
            <p className={styles.featuredDescription}>{channel.description}</p>
          )}
        </div>
        <div className={styles.featuredFooter}>
          <p className="channel-owner-name">{channel.ownerName}</p>
          <span className={styles.featuredAction} aria-hidden="true">
            Watch live
            <ArrowUpRight className="size-4" />
          </span>
        </div>
      </div>
    </Link>
  )
}

function ChannelRow({ channel }: { channel: PublicChannel }) {
  const initial = channel.title.trim().charAt(0).toUpperCase() || '•'
  const live = channel.status.live

  return (
    <Link
      aria-label={`Watch ${channel.title} by ${channel.ownerName}, ${channel.status.state}`}
      className={`${styles.channelRow}${live ? ` ${styles.isLive}` : ''}`}
      href={`/watch/${encodeURIComponent(channel.slug)}`}
      style={{ '--accent': channel.accentColor } as CSSProperties}
    >
      {live ? (
        <span className={styles.channelRowThumb} aria-hidden="true">
          {channel.poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" src={channel.poster} />
          ) : (
            initial
          )}
        </span>
      ) : (
        <span className={styles.channelRowAvatar} aria-hidden="true">
          {channel.poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" src={channel.poster} />
          ) : (
            initial
          )}
        </span>
      )}
      <span className={styles.channelRowCopy}>
        <span className={styles.channelRowTitle}>{channel.title}</span>
        <span className={styles.channelRowOwner}>{channel.ownerName}</span>
      </span>
      <span className={styles.channelRowMeta}>
        <StatusBadge compact state={channel.status.state} />
        <ViewerCount
          compact
          count={channel.status.viewerCount}
          live={channel.status.live}
        />
        <span className={styles.channelRowArrow} aria-hidden="true">
          <ArrowUpRight className="size-4" />
        </span>
      </span>
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
  const [featuredSlug, setFeaturedSlug] = useState<string | null>(
    () => model.featuredChannel?.slug ?? null,
  )
  const lastLiveKey = useRef<string | null>(null)
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

  useEffect(() => {
    const live = channels.filter((channel) => channel.status.live)
    const key = live.map((channel) => channel.slug).sort().join('|')
    if (key === lastLiveKey.current) return
    lastLiveKey.current = key
    setFeaturedSlug(
      live.length === 0
        ? null
        : live[Math.floor(Math.random() * live.length)].slug,
    )
  }, [channels])

  const featuredChannel =
    channels.find(
      (channel) => channel.slug === featuredSlug && channel.status.live,
    ) ?? null

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

      {featuredChannel ? (
        <section className={styles.featuredSection} aria-labelledby="live-heading">
          <div className={styles.dashboardSectionHeading}>
            <div>
              <p className="eyebrow">On air</p>
              <h2 id="live-heading">Live now</h2>
            </div>
            {statusDelayed && <p>Showing the last known channel status.</p>}
          </div>
          <FeaturedChannel channel={featuredChannel} />
        </section>
      ) : (
        <section
          className={`${styles.quietState} ${model.statusUnavailable ? styles.quietStateWarning : ''}`}
          aria-labelledby="quiet-heading"
        >
          <span className={styles.quietIcon}>
            {model.statusUnavailable ? (
              <SignalZero aria-hidden="true" />
            ) : (
              <RadioTower aria-hidden="true" />
            )}
          </span>
          <div>
            <p className="eyebrow">
              {model.statusUnavailable ? 'Signal check delayed' : 'Between broadcasts'}
            </p>
            <h2 id="quiet-heading">
              {model.statusUnavailable ? 'Status is temporarily unavailable.' : 'Quiet right now.'}
            </h2>
            <p>
              {model.statusUnavailable
                ? 'Channels are still available. Open one to check the stream directly.'
                : 'No broadcasts are live. You can still open a channel and wait there.'}
            </p>
          </div>
        </section>
      )}

      <section className={styles.channelSection} aria-labelledby="channels-heading">
        <div className={styles.dashboardSectionHeading}>
          <div>
            <p className="eyebrow">The group</p>
            <h2 id="channels-heading">All channels</h2>
          </div>
          <p>
            {statusDelayed ? 'Waiting for a fresh status check.' : 'Status updates automatically.'}
          </p>
        </div>
        {model.allChannels.length > 0 ? (
          <div className={styles.channelList}>
            {model.allChannels.map((channel) => (
              <ChannelRow channel={channel} key={channel.slug} />
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
