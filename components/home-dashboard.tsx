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

import { ChannelCard } from '@/components/channel-card'
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
      className="featured-channel"
      href={`/watch/${encodeURIComponent(channel.slug)}`}
      style={{ '--accent': channel.accentColor } as CSSProperties}
    >
      <div className="featured-artwork">
        {channel.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" src={channel.poster} />
        ) : (
          <span aria-hidden="true">{initial}</span>
        )}
        <div className="featured-status">
          <StatusBadge compact state={channel.status.state} />
          <ViewerCount
            compact
            count={channel.status.viewerCount}
            live={channel.status.live}
          />
        </div>
      </div>
      <div className="featured-details">
        <div className="featured-copy">
          <h2>{channel.title}</h2>
          {channel.description && (
            <p className="featured-description">{channel.description}</p>
          )}
        </div>
        <div className="featured-footer">
          <p className="channel-owner-name">{channel.ownerName}</p>
          <span className="featured-action" aria-hidden="true">
            Watch live
            <ArrowUpRight className="size-4" />
          </span>
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
    <main className="home-layout">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <section className="home-intro" aria-labelledby="home-title">
        <div>
          <p className="eyebrow">Private streams</p>
          <h1 id="home-title">What are we watching?</h1>
          <p>A small place for broadcasts from the group.</p>
        </div>
        <div className="home-intro-side">
          <p
            className={`live-summary ${
              statusDelayed
                ? 'is-delayed'
                : model.liveCount > 0
                  ? 'is-live'
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
            <nav className="home-shortcuts" aria-label="Channel shortcuts">
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

      {model.featuredChannel ? (
        <section className="featured-section" aria-labelledby="live-heading">
          <div className="dashboard-section-heading">
            <div>
              <p className="eyebrow">On air</p>
              <h2 id="live-heading">Live now</h2>
            </div>
            {statusDelayed && <p>Showing the last known channel status.</p>}
          </div>
          <FeaturedChannel channel={model.featuredChannel} />
        </section>
      ) : (
        <section
          className={`quiet-state ${model.statusUnavailable ? 'quiet-state-warning' : ''}`}
          aria-labelledby="quiet-heading"
        >
          <span className="quiet-icon">
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

      {model.remainingLiveChannels.length > 0 && (
        <section className="more-live-section" aria-labelledby="more-live-heading">
          <div className="dashboard-section-heading">
            <h2 id="more-live-heading">More live</h2>
            <p>{model.remainingLiveChannels.length} more broadcasting</p>
          </div>
          <div className="channel-grid channel-grid-live">
            {model.remainingLiveChannels.map((channel) => (
              <ChannelCard channel={channel} key={channel.slug} />
            ))}
          </div>
        </section>
      )}

      <section className="channel-section" aria-labelledby="channels-heading">
        <div className="dashboard-section-heading">
          <div>
            <p className="eyebrow">The group</p>
            <h2 id="channels-heading">All channels</h2>
          </div>
          <p>
            {statusDelayed ? 'Waiting for a fresh status check.' : 'Status updates automatically.'}
          </p>
        </div>
        {model.allChannels.length > 0 ? (
          <div className="channel-grid">
            {model.allChannels.map((channel) => (
              <ChannelCard channel={channel} key={channel.slug} />
            ))}
          </div>
        ) : (
          <div className="no-channels-state">
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
