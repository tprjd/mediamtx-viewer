import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'

import { StatusBadge } from '@/components/status-badge'
import type { PublicChannel } from '@/lib/types'

interface ChannelCardProps {
  channel: PublicChannel
}

export function ChannelCard({ channel }: ChannelCardProps) {
  const initial = channel.title.trim().charAt(0).toUpperCase() || '•'

  return (
    <Link
      aria-label={`Watch ${channel.title} by ${channel.ownerName}, ${channel.status.state}`}
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
            <span aria-hidden="true">{initial}</span>
          </div>
        )}
        <div className="absolute left-4 top-4">
          <StatusBadge compact state={channel.status.state} />
        </div>
      </div>
      <div className="channel-card-details">
        <div className="channel-card-copy">
          <h3>{channel.title}</h3>
          {channel.description && (
            <p className="channel-card-description">{channel.description}</p>
          )}
        </div>
        <div className="channel-card-footer">
          <p className="channel-owner-name">{channel.ownerName}</p>
          <span className="channel-card-arrow" aria-hidden="true">
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </span>
        </div>
      </div>
    </Link>
  )
}
