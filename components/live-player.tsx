'use client'

import { Gauge, Scale, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import {
  HlsPlayer,
  type HlsLatencyProfile,
} from '@/components/hls-player'
import { Button } from '@/components/ui/button'
import { WebRtcPlayer } from '@/components/webrtc-player'
import type { PublicChannel } from '@/lib/types'

interface LivePlayerProps {
  channel: PublicChannel
}

type PlaybackMode = HlsLatencyProfile | 'webrtc'

const MODE_STORAGE_KEY = 'mediamtx-viewer:playback-mode'
const WEBRTC_RETRY_COOLDOWN_MS = 60_000

export function LivePlayer({ channel }: LivePlayerProps) {
  const [mode, setMode] = useState<PlaybackMode>(
    channel.preferredPlayback === 'webrtc' ? 'webrtc' : 'balanced',
  )
  const [fallback, setFallback] = useState<{
    retryAfter: number
    startedAt: string | null
  } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.sessionStorage.getItem(MODE_STORAGE_KEY)
      if (saved === 'hls') {
        window.sessionStorage.setItem(MODE_STORAGE_KEY, 'balanced')
        setMode('balanced')
      }
      if (saved === 'balanced' || saved === 'smooth' || saved === 'webrtc') {
        setMode(saved)
      }
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

  const selectMode = useCallback((next: PlaybackMode) => {
    setMode(next)
    window.sessionStorage.setItem(MODE_STORAGE_KEY, next)
  }, [])

  const handleFallback = useCallback(() => {
    const cooldown = Date.now() + WEBRTC_RETRY_COOLDOWN_MS
    setFallback({ retryAfter: cooldown, startedAt: channel.status.startedAt })
    setNow(Date.now())
    selectMode('smooth')
  }, [channel.status.startedAt, selectMode])

  const retrySeconds = Math.max(0, Math.ceil((retryAfter - now) / 1_000))
  const lowLatencyDisabled = !channel.status.live || retrySeconds > 0

  return (
    <div className="live-player">
      <div className="playback-mode-switch" aria-label="Playback mode">
        <div>
          <strong>Playback mode</strong>
          <span>
            {mode === 'balanced' && 'Testing lower delay · target about 3–5s.'}
            {mode === 'smooth' && 'Extra recovery margin · about 5–8s behind live.'}
            {mode === 'webrtc' && 'Lowest delay with less recovery margin.'}
          </span>
        </div>
        <div className="playback-mode-actions">
          <Button
            aria-pressed={mode === 'balanced'}
            onClick={() => selectMode('balanced')}
            size="sm"
            variant={mode === 'balanced' ? 'default' : 'secondary'}
          >
            <Scale className="size-3.5" aria-hidden="true" />
            Balanced
          </Button>
          <Button
            aria-pressed={mode === 'smooth'}
            onClick={() => selectMode('smooth')}
            size="sm"
            variant={mode === 'smooth' ? 'default' : 'secondary'}
          >
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Smooth
          </Button>
          <Button
            aria-pressed={mode === 'webrtc'}
            disabled={lowLatencyDisabled}
            onClick={() => selectMode('webrtc')}
            size="sm"
            title={
              retrySeconds > 0
                ? `Low-latency retry available in ${retrySeconds} seconds`
                : undefined
            }
            variant={mode === 'webrtc' ? 'default' : 'secondary'}
          >
            <Gauge className="size-3.5" aria-hidden="true" />
            {retrySeconds > 0
              ? `Try low latency in ${retrySeconds}s`
              : 'Low latency'}
          </Button>
        </div>
      </div>

      {mode === 'webrtc' ? (
        <WebRtcPlayer
          channel={channel}
          onFallback={handleFallback}
        />
      ) : (
        <HlsPlayer channel={channel} latencyProfile={mode} />
      )}
    </div>
  )
}
