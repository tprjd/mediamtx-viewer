'use client'

import Link from 'next/link'
import { RadioTower } from 'lucide-react'

import styles from './live-rail.module.css'

import { ViewerCount } from '@/components/viewer-count'
import { buildLiveRailModel } from '@/lib/live-rail'
import type { PublicChannel } from '@/lib/types'

interface LiveRailProps {
  channels: readonly PublicChannel[]
  watchedSlug: string
}

function channelInitial(channel: PublicChannel): string {
  return channel.title.trim().charAt(0).toUpperCase() || '•'
}

export function LiveRail({ channels, watchedSlug }: LiveRailProps) {
  const model = buildLiveRailModel(channels, watchedSlug)

  return (
    <aside className={styles.liveRail} aria-label="Live channels">
      <div className={styles.railHeading}>
        <RadioTower className={styles.railIcon} aria-hidden="true" />
        <h2>Live</h2>
      </div>
      {model.liveChannels.length > 0 ? (
        <nav className={styles.railList} aria-label="Live channel list">
          {model.liveChannels.map((channel) => {
            const active = channel.slug === model.watchedSlug
            return (
              <Link
                aria-current={active ? 'page' : undefined}
                aria-label={`Watch ${channel.title} by ${channel.ownerName}, ${channel.status.viewerCount ?? 'unknown'} viewers`}
                className={`${styles.railItem}${active ? ` ${styles.isActive}` : ''}`}
                href={`/watch/${encodeURIComponent(channel.slug)}`}
                key={channel.slug}
              >
                <span className={styles.channelInitial} aria-hidden="true">
                  {channelInitial(channel)}
                </span>
                <span className={styles.channelCopy}>
                  <span className={styles.channelTitle}>{channel.title}</span>
                  <span className={styles.channelOwner}>{channel.ownerName}</span>
                  <ViewerCount
                    compact
                    count={channel.status.viewerCount}
                    live
                  />
                </span>
              </Link>
            )
          })}
        </nav>
      ) : (
        <p className={styles.emptyState}>No live channels</p>
      )}
    </aside>
  )
}
