import { AlertTriangle, LoaderCircle, Radio } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { buttonVariants } from '@/components/ui/button'
import type { PlaybackRunState } from '@/lib/playback-run'

interface PlaybackRunOverlayProps {
  channelSlug: string
  children?: ReactNode
  loadingDescription: string
  loadingTitle: string
  progressAction?: ReactNode
  reconnectingDescription: string
  state: PlaybackRunState
}

export function PlaybackRunOverlay({
  channelSlug,
  children,
  loadingDescription,
  loadingTitle,
  progressAction,
  reconnectingDescription,
  state,
}: PlaybackRunOverlayProps) {
  if (state === 'playing') return null

  return (
    <div className="player-overlay" aria-live="polite">
      {state === 'offline' ? (
        <div className="player-message">
          <span className="player-icon">
            <Radio className="size-6" aria-hidden="true" />
          </span>
          <h2>Stream offline</h2>
          <p>This page will start checking again automatically.</p>
        </div>
      ) : state === 'unauthorized' ? (
        <div className="player-message">
          <span className="player-icon player-icon-warning">
            <AlertTriangle className="size-6" aria-hidden="true" />
          </span>
          <h2>Session expired</h2>
          <p>Sign in again to continue watching.</p>
          <Link
            className={buttonVariants({ size: 'sm', variant: 'secondary' })}
            href={`/login?returnTo=${encodeURIComponent(`/watch/${channelSlug}`)}`}
          >
            Sign in
          </Link>
        </div>
      ) : state === 'loading' || state === 'reconnecting' ? (
        <div className="player-message">
          <span className="player-icon">
            <LoaderCircle
              className="size-6 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          </span>
          <h2>{state === 'loading' ? loadingTitle : 'Reconnecting'}</h2>
          <p>
            {state === 'loading' ? loadingDescription : reconnectingDescription}
          </p>
          {progressAction}
        </div>
      ) : (
        children
      )}
    </div>
  )
}
