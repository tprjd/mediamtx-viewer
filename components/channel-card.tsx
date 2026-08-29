import { ArrowUpRight, Gamepad2 } from 'lucide-react'
import Link from 'next/link'

import { StatusBadge } from '@/components/status-badge'
import type { PublicChannel } from '@/lib/types'

interface ChannelCardProps {
  channel: PublicChannel
}

export function ChannelCard({ channel }: ChannelCardProps) {
  return (
    <Link
      className="channel-card group"
      href={`/watch/${encodeURIComponent(channel.slug)}`}
      style={{ '--accent': channel.accentColor } as React.CSSProperties}
    >
      <div className="channel-card-preview">
        {channel.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="size-full object-cover" src={channel.poster} />
        ) : (
          <div className="channel-card-placeholder">
            <Gamepad2 className="size-10" aria-hidden="true" />
          </div>
        )}
        <div className="absolute left-4 top-4">
          <StatusBadge compact state={channel.status.state} />
        </div>
      </div>
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-[0.16em] text-neutral-500">
            {channel.displayName}
          </p>
          <h2 className="mt-1 truncate text-lg font-semibold text-white">
            {channel.title}
          </h2>
          {channel.description && (
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-neutral-400">
              {channel.description}
            </p>
          )}
        </div>
        <span className="mt-1 rounded-full border border-white/10 p-2 text-neutral-400 transition group-hover:border-white/20 group-hover:text-white">
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </span>
      </div>
    </Link>
  )
}
