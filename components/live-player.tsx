'use client'

import { Gauge, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { HlsPlayer } from '@/components/hls-player'
import { Button } from '@/components/ui/button'
import { WebRtcPlayer } from '@/components/webrtc-player'
import type { PublicChannel } from '@/lib/types'

interface LivePlayerProps {
  channel: PublicChannel
}

type PlaybackProtocol = 'webrtc' | 'hls'

const MODE_STORAGE_KEY = 'mediamtx-viewer:playback-mode'
const WEBRTC_RETRY_COOLDOWN_MS = 60_000

export function LivePlayer({ channel }: LivePlayerProps) {
  const [protocol, setProtocol] = useState<PlaybackProtocol>(
    channel.preferredPlayback,
  )
  const [fallback, setFallback] = useState<{
    retryAfter: number
    startedAt: string | null
  } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.sessionStorage.getItem(MODE_STORAGE_KEY)
      if (saved === 'hls' || saved === 'webrtc') setProtocol(saved)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const retryAfter =
    fallback?.startedAt === channel.status.startedAt ? fallback.retryAfter : 0

  useEffect(() => {
    if (retryAfter <= now) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [now, retryAfter])

  const selectProtocol = useCallback((next: PlaybackProtocol) => {
    setProtocol(next)
    window.sessionStorage.setItem(MODE_STORAGE_KEY, next)
  }, [])

  const handleFallback = useCallback(() => {
    const cooldown = Date.now() + WEBRTC_RETRY_COOLDOWN_MS
    setFallback({ retryAfter: cooldown, startedAt: channel.status.startedAt })
    setNow(Date.now())
    selectProtocol('hls')
  }, [channel.status.startedAt, selectProtocol])

  const retrySeconds = Math.max(0, Math.ceil((retryAfter - now) / 1_000))
  const lowLatencyDisabled = !channel.status.live || retrySeconds > 0

  return (
    <div className="live-player">
      <div className="playback-mode-switch" aria-label="Playback mode">
        <div>
          <strong>Playback mode</strong>
          <span>
            {protocol === 'hls'
              ? 'Smooth adds a small buffer for steadier playback.'
              : 'Low latency prioritizes immediacy over recovery margin.'}
          </span>
        </div>
        <div className="playback-mode-actions">
          <Button
            aria-pressed={protocol === 'hls'}
            onClick={() => selectProtocol('hls')}
            size="sm"
            variant={protocol === 'hls' ? 'default' : 'secondary'}
          >
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Smooth
          </Button>
          <Button
            aria-pressed={protocol === 'webrtc'}
            disabled={lowLatencyDisabled}
            onClick={() => selectProtocol('webrtc')}
            size="sm"
            title={
              retrySeconds > 0
                ? `Low-latency retry available in ${retrySeconds} seconds`
                : undefined
            }
            variant={protocol === 'webrtc' ? 'default' : 'secondary'}
          >
            <Gauge className="size-3.5" aria-hidden="true" />
            {retrySeconds > 0
              ? `Try low latency in ${retrySeconds}s`
              : 'Low latency'}
          </Button>
        </div>
      </div>

      {protocol === 'webrtc' ? (
        <WebRtcPlayer
          channel={channel}
          onFallback={handleFallback}
        />
      ) : (
        <HlsPlayer channel={channel} />
      )}
    </div>
  )
}
