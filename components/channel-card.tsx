import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import styles from './channel-card.module.css'

import { StatusBadge } from '@/components/status-badge'
import { ViewerCount } from '@/components/viewer-count'
import type { PublicChannel } from '@/lib/types'

interface ChannelCardProps {
  channel: PublicChannel
}

export function ChannelCard({ channel }: ChannelCardProps) {
  const initial = channel.title.trim().charAt(0).toUpperCase() || '•'

  return (
    <Link
      aria-label={`Watch ${channel.title} by ${channel.ownerName}, ${channel.status.state}`}
      className={`${styles.channelCard} group`}
      href={`/watch/${encodeURIComponent(channel.slug)}`}
      style={{ '--accent': channel.accentColor } as React.CSSProperties}
    >
      <div className={styles.channelCardPreview}>
        {channel.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="size-full object-cover" src={channel.poster} />
        ) : (
          <div className={styles.channelCardPlaceholder}>
            <span aria-hidden="true">{initial}</span>
          </div>
        )}
        <div className={styles.channelCardStatus}>
          <StatusBadge compact state={channel.status.state} />
          <ViewerCount
            compact
            count={channel.status.viewerCount}
            live={channel.status.live}
          />
        </div>
      </div>
      <div className={styles.channelCardDetails}>
        <div className={styles.channelCardCopy}>
          <h3>{channel.title}</h3>
          {channel.description && (
            <p className={styles.channelCardDescription}>{channel.description}</p>
          )}
        </div>
        <div className={styles.channelCardFooter}>
          <p className="channel-owner-name">{channel.ownerName}</p>
          <span className={styles.channelCardArrow} aria-hidden="true">
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </span>
        </div>
      </div>
    </Link>
  )
}
