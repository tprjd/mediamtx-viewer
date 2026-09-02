'use client'

import { Clock3, UserRound } from 'lucide-react'

import { LivePlayer } from '@/components/live-player'
import { ShareButton } from '@/components/share-button'
import { StatusBadge } from '@/components/status-badge'
import { ViewerCount } from '@/components/viewer-count'
import { useChannelEvents } from '@/hooks/use-channel-events'
import type { PublicChannel } from '@/lib/types'

interface ChannelViewerProps {
  channel: PublicChannel
  viewerId?: string
}

export function ChannelViewer({ channel, viewerId }: ChannelViewerProps) {
  const { channels } = useChannelEvents([channel])
  const currentChannel = channels[0] ?? channel
  const status = currentChannel.status

  return (
    <main className="watch-layout">
      <div className="watch-player-wrap">
        <LivePlayer channel={currentChannel} viewerId={viewerId} />
      </div>

      <section className="watch-details">
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            <StatusBadge state={status.state} />
            <ViewerCount count={status.viewerCount} live={status.live} />
          </div>
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {currentChannel.title}
          </h1>
          {currentChannel.description && (
            <p className="mt-3 max-w-2xl text-pretty text-sm leading-6 text-neutral-400 sm:text-base sm:leading-7">
              {currentChannel.description}
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="size-3.5" aria-hidden="true" />
              {currentChannel.ownerName}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="size-3.5" aria-hidden="true" />
              Live playback
            </span>
            {status.tracks.length > 0 && (
              <span>{status.tracks.join(' · ')}</span>
            )}
          </div>
        </div>
        <ShareButton title={currentChannel.title} />
      </section>
    </main>
  )
}
