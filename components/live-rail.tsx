'use client'

import * as Tooltip from '@radix-ui/react-tooltip'
import { PanelLeftClose, PanelLeftOpen, RadioTower } from 'lucide-react'
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'

import styles from './live-rail.module.css'

import { useLiveRailPreference } from '@/components/use-live-rail-preference'
import { ViewerCount } from '@/components/viewer-count'
import { buildLiveRailModel } from '@/lib/live-rail'
import type { PublicChannel, StreamState } from '@/lib/types'

interface LiveRailProps {
  channels: readonly PublicChannel[]
  watchedSlug: string
}

interface ChannelLinkProps {
  channel: PublicChannel
  collapsed: boolean
  current: boolean
}

function ownerInitials(ownerName: string): string {
  return (
    ownerName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '•'
  )
}

function stateLabel(state: StreamState): string {
  if (state === 'live') return 'Live'
  if (state === 'unavailable') return 'Unavailable'
  return 'Offline'
}

function viewerCountLabel(count: number | null): string {
  if (count === null) return 'viewer count unavailable'
  return `${count} ${count === 1 ? 'viewer' : 'viewers'}`
}

function channelDescription(channel: PublicChannel): string {
  const details = [
    `Watch ${channel.title} by ${channel.ownerName}`,
    channel.status.state,
  ]
  if (channel.status.live) {
    details.push(
      viewerCountLabel(channel.status.viewerCount),
    )
  }
  return details.join(', ')
}

function ChannelLink({ channel, collapsed, current }: ChannelLinkProps) {
  const link = (
    <Link
      aria-current={current ? 'page' : undefined}
      aria-label={channelDescription(channel)}
      className={`${styles.railItem}${current ? ` ${styles.isActive}` : ''}${channel.status.live ? ` ${styles.isLive}` : ` ${styles.isMuted}`}`}
      href={`/watch/${encodeURIComponent(channel.slug)}`}
      style={{ '--channel-accent': channel.accentColor } as CSSProperties}
    >
      <span className={styles.channelInitial} aria-hidden="true">
        {ownerInitials(channel.ownerName)}
      </span>
      {!collapsed && (
        <span className={styles.channelCopy}>
          <span className={styles.channelTitle}>{channel.title}</span>
          <span className={styles.channelOwner}>{channel.ownerName}</span>
          <span className={styles.channelStatus}>
            <span>{stateLabel(channel.status.state)}</span>
            {channel.status.live && (
              <ViewerCount compact count={channel.status.viewerCount} live />
            )}
          </span>
        </span>
      )}
    </Link>
  )

  if (!collapsed) return link

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className={styles.tooltipContent}
          side="right"
          sideOffset={8}
        >
          <strong>{channel.title}</strong>
          <span>{channel.ownerName}</span>
          <span>
            {stateLabel(channel.status.state)}
            {channel.status.live
              ? channel.status.viewerCount === null
                ? ' Viewer count unavailable'
                : ` ${viewerCountLabel(channel.status.viewerCount)}`
              : ''}
          </span>
          <Tooltip.Arrow className={styles.tooltipArrow} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

function ChannelGroup({
  channels,
  collapsed,
  heading,
  watchedSlug,
}: {
  channels: readonly PublicChannel[]
  collapsed: boolean
  heading: string
  watchedSlug: string
}) {
  return (
    <section
      className={styles.channelGroup}
      aria-label={collapsed ? heading : undefined}
    >
      {!collapsed && <h2>{heading}</h2>}
      {channels.map((channel) => (
        <ChannelLink
          channel={channel}
          collapsed={collapsed}
          current={channel.slug === watchedSlug}
          key={channel.slug}
        />
      ))}
    </section>
  )
}

export function LiveRail({ channels, watchedSlug }: LiveRailProps) {
  const model = buildLiveRailModel(channels, watchedSlug)
  const { effectivePreference, setPreference } = useLiveRailPreference()

  const collapsed = effectivePreference === 'collapsed'
  const groups: ReactNode[] = []

  if (model.liveChannels.length > 0) {
    groups.push(
      <ChannelGroup
        channels={model.liveChannels}
        collapsed={collapsed}
        heading="Live Channels"
        key="live"
        watchedSlug={model.watchedSlug}
      />,
    )
  } else if (!collapsed) {
    groups.push(
      <p className={styles.emptyState} key="no-live">
        No Channels are live.
      </p>,
    )
  }

  if (model.otherChannels.length > 0) {
    groups.push(
      <ChannelGroup
        channels={model.otherChannels}
        collapsed={collapsed}
        heading="Other Channels"
        key="other"
        watchedSlug={model.watchedSlug}
      />,
    )
  }

  return (
    <Tooltip.Provider delayDuration={0}>
      <aside
        className={`${styles.liveRail}${collapsed ? ` ${styles.collapsed}` : ''}`}
        aria-label="Channels"
        data-rail-state={effectivePreference}
      >
        <div className={styles.railHeading}>
          {!collapsed && (
            <RadioTower className={styles.railIcon} aria-hidden="true" />
          )}
          {!collapsed && <strong>Channels</strong>}
          <button
            aria-label={collapsed ? 'Expand Channel rail' : 'Collapse Channel rail'}
            className={styles.railToggle}
            onClick={() => setPreference(collapsed ? 'expanded' : 'collapsed')}
            title={collapsed ? 'Expand Channel rail' : 'Collapse Channel rail'}
            type="button"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" />
            ) : (
              <PanelLeftClose aria-hidden="true" />
            )}
          </button>
        </div>
        <nav className={styles.railList} aria-label="Channel list">
          {groups}
        </nav>
      </aside>
    </Tooltip.Provider>
  )
}
