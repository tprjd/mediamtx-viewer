'use client'

import { Clock3, UserRound } from 'lucide-react'

import { LivePlayer } from '@/components/live-player'
import { ShareButton } from '@/components/share-button'
import { StatusBadge } from '@/components/status-badge'
import { useChannelStatus } from '@/hooks/use-channel-status'
import type { PublicChannel } from '@/lib/types'

interface ChannelViewerProps {
  channel: PublicChannel
}

export function ChannelViewer({ channel }: ChannelViewerProps) {
  const status = useChannelStatus(channel.slug, channel.status)
  const generatedThumbnailPrefix = `/api/channels/${encodeURIComponent(channel.slug)}/thumbnail`
  const currentChannel = {
    ...channel,
    poster:
      !status.live && channel.poster?.startsWith(generatedThumbnailPrefix)
        ? undefined
        : channel.poster,
    status,
  }

  return (
    <main className="watch-layout">
      <div className="watch-player-wrap">
        <LivePlayer channel={currentChannel} />
      </div>

      <section className="watch-details">
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            <StatusBadge state={status.state} />
          </div>
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {channel.title}
          </h1>
          {channel.description && (
            <p className="mt-3 max-w-2xl text-pretty text-sm leading-6 text-neutral-400 sm:text-base sm:leading-7">
              {channel.description}
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="size-3.5" aria-hidden="true" />
              {channel.ownerName}
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
        <ShareButton title={channel.title} />
      </section>
    </main>
  )
}
