import { Clock3 } from 'lucide-react'

import { LivePlayer } from '@/components/live-player'
import { ShareButton } from '@/components/share-button'
import { StatusBadge } from '@/components/status-badge'
import type { PublicChannel } from '@/lib/types'

interface ChannelViewerProps {
  channel: PublicChannel
}

export function ChannelViewer({ channel }: ChannelViewerProps) {
  return (
    <main className="watch-layout">
      <div className="watch-player-wrap">
        <LivePlayer channel={channel} />
      </div>

      <section className="watch-details">
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            <StatusBadge state={channel.status.state} />
            <span className="text-sm text-neutral-500">{channel.displayName}</span>
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
              <Clock3 className="size-3.5" aria-hidden="true" />
              Live playback
            </span>
            {channel.status.tracks.length > 0 && (
              <span>{channel.status.tracks.join(' · ')}</span>
            )}
          </div>
        </div>
        <ShareButton title={channel.title} />
      </section>
    </main>
  )
}
