'use client'

import Link from 'next/link'
import { PanelLeftClose, PanelLeftOpen, RadioTower } from 'lucide-react'

import styles from './live-rail.module.css'

import { useLiveRailPreference } from '@/components/use-live-rail-preference'
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
  const { effectivePreference, setPreference } = useLiveRailPreference()

  if (effectivePreference === 'hidden') return null

  const collapsed = effectivePreference === 'collapsed'

  return (
    <aside
      className={`${styles.liveRail}${collapsed ? ` ${styles.collapsed}` : ''}`}
      aria-label="Live channels"
      data-rail-state={effectivePreference}
    >
      <div className={styles.railHeading}>
        <RadioTower className={styles.railIcon} aria-hidden="true" />
        {!collapsed && <h2>Live</h2>}
        <button
          aria-label={collapsed ? 'Expand live rail' : 'Collapse live rail'}
          className={styles.railToggle}
          onClick={() => setPreference(collapsed ? 'expanded' : 'collapsed')}
          title={collapsed ? 'Expand live rail' : 'Collapse live rail'}
          type="button"
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" />
          ) : (
            <PanelLeftClose aria-hidden="true" />
          )}
        </button>
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
                {!collapsed && (
                  <span className={styles.channelCopy}>
                    <span className={styles.channelTitle}>{channel.title}</span>
                    <span className={styles.channelOwner}>{channel.ownerName}</span>
                    <ViewerCount
                      compact
                      count={channel.status.viewerCount}
                      live
                    />
                  </span>
                )}
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
