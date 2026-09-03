'use client'

import { Gauge, Scale, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  HlsPlayer,
  isHlsJsSupported,
} from '@/components/hls-player'
import { Button } from '@/components/ui/button'
import { WebRtcPlayer } from '@/components/webrtc-player'
import {
  hlsPlaybackContract,
  type PlaybackMode,
  ultraLowFallback,
  webRtcTransportFallback,
} from '@/lib/streaming-contract'
import type { PublicChannel } from '@/lib/types'

interface LivePlayerProps {
  channel: PublicChannel
  viewerId?: string
}

const MODE_STORAGE_KEY = 'mediamtx-viewer:playback-mode'
const VIEWER_QUERY_PARAMETER = 'frankerzspam_viewer'
const ultraLowContract = hlsPlaybackContract('ultra-low')
const webRtcFallback = webRtcTransportFallback()

function tagPlaybackUrl(url: string, viewerId: string | undefined): string {
  if (!viewerId) return url

  const [withoutHash, hash] = url.split('#', 2)
  const separator = withoutHash.includes('?') ? '&' : '?'
  const query = `${VIEWER_QUERY_PARAMETER}=${encodeURIComponent(viewerId)}`
  return `${withoutHash}${separator}${query}${hash === undefined ? '' : `#${hash}`}`
}

export function LivePlayer({ channel, viewerId }: LivePlayerProps) {
  const [mode, setMode] = useState<PlaybackMode>(
    channel.preferredPlayback === 'webrtc' ? 'webrtc' : 'balanced',
  )
  const [fallback, setFallback] = useState<{
    retryAfter: number
    startedAt: string | null
  } | null>(null)
  const [balancedUnavailable, setBalancedUnavailable] = useState(false)
  const [ultraLowSupported, setUltraLowSupported] = useState(false)
  const [ultraLowUnavailableReason, setUltraLowUnavailableReason] =
    useState<string>()
  const [modeExitReason, setModeExitReason] = useState<string>()
  const [now, setNow] = useState(() => Date.now())
  const taggedChannel = useMemo<PublicChannel>(
    () => ({
      ...channel,
      playback: {
        hls: tagPlaybackUrl(channel.playback.hls, viewerId),
        webrtc: tagPlaybackUrl(channel.playback.webrtc, viewerId),
        fallbackHls: channel.playback.fallbackHls
          ? tagPlaybackUrl(channel.playback.fallbackHls, viewerId)
          : undefined,
      },
    }),
    [channel, viewerId],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const supportsUltraLow = isHlsJsSupported()
      setUltraLowSupported(supportsUltraLow)
      setUltraLowUnavailableReason(
        supportsUltraLow
          ? undefined
          : `${ultraLowContract.label} requires hls.js and Media Source Extensions.`,
      )
      const saved = window.sessionStorage.getItem(MODE_STORAGE_KEY)
      if (saved === 'hls') {
        window.sessionStorage.setItem(MODE_STORAGE_KEY, 'balanced')
        setMode('balanced')
      }
      if (saved === 'ultra-low') {
        if (supportsUltraLow) {
          setMode('ultra-low')
        } else {
          window.sessionStorage.setItem(MODE_STORAGE_KEY, 'balanced')
          setMode('balanced')
          setModeExitReason(
            `${ultraLowContract.label} requires hls.js and is unavailable in this browser.`,
          )
        }
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
    setModeExitReason(undefined)
    setMode(next)
    window.sessionStorage.setItem(MODE_STORAGE_KEY, next)
  }, [])

  const handleFallback = useCallback(() => {
    const cooldown = Date.now() + (webRtcFallback.retryCooldownMs ?? 0)
    setFallback({ retryAfter: cooldown, startedAt: channel.status.startedAt })
    setNow(Date.now())
    selectMode(webRtcFallback.mode)
  }, [channel.status.startedAt, selectMode])

  const handleBalancedUnavailable = useCallback(() => {
    setBalancedUnavailable(true)
    selectMode('smooth')
  }, [selectMode])

  const handleUltraLowUnavailable = useCallback((reason?: string) => {
    const unavailableReason = reason ??
      `${ultraLowContract.label} requires hls.js and is unavailable in this browser.`
    setUltraLowSupported(false)
    setUltraLowUnavailableReason(unavailableReason)
    if (mode !== 'ultra-low') return
    selectMode(ultraLowFallback('unavailable'))
    setModeExitReason(unavailableReason)
  }, [mode, selectMode])

  const handleUltraLowFailure = useCallback((reason: string) => {
    const fallbackMode = ultraLowFallback('unstable')
    selectMode(fallbackMode)
    setModeExitReason(
      `${reason} Switched to ${hlsPlaybackContract(fallbackMode).label}.`,
    )
  }, [selectMode])

  const retrySeconds = Math.max(0, Math.ceil((retryAfter - now) / 1_000))
  const lowLatencyDisabled = !channel.status.live || retrySeconds > 0

  return (
    <div className="live-player">
      <div className="playback-mode-switch" aria-label="Playback mode">
        <div>
          <strong>Playback mode</strong>
          <span role={modeExitReason ? 'status' : undefined}>
            {modeExitReason ?? (
              <>
                {mode === 'ultra-low' &&
                  'Experimental HLS · shortest buffer and strict live-edge correction.'}
                {mode === 'balanced' &&
                  'Lower delay with moderate recovery margin.'}
                {mode === 'smooth' &&
                  'Extra recovery margin for unstable connections.'}
                {mode === 'webrtc' && 'Lowest delay with less recovery margin.'}
              </>
            )}
          </span>
        </div>
        <div className="playback-mode-actions">
          <Button
            aria-pressed={mode === 'ultra-low'}
            disabled={!ultraLowSupported}
            onClick={() => selectMode('ultra-low')}
            size="sm"
            title={
              ultraLowSupported
                ? 'Experimental HLS mode with minimal recovery margin'
                : ultraLowUnavailableReason ?? 'Checking hls.js support'
            }
            variant={mode === 'ultra-low' ? 'default' : 'secondary'}
          >
            <Gauge className="size-3.5" aria-hidden="true" />
            {ultraLowSupported
              ? ultraLowContract.label
              : `${ultraLowContract.label} unavailable`}
          </Button>
          <Button
            aria-pressed={mode === 'balanced'}
            disabled={balancedUnavailable}
            onClick={() => selectMode('balanced')}
            size="sm"
            title={
              balancedUnavailable
                ? 'This browser does not expose a reliable native HLS live edge'
                : undefined
            }
            variant={mode === 'balanced' ? 'default' : 'secondary'}
          >
            <Scale className="size-3.5" aria-hidden="true" />
            {balancedUnavailable ? 'Balanced unavailable' : 'Balanced'}
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
          channel={taggedChannel}
          onFallback={handleFallback}
        />
      ) : (
        <HlsPlayer
          channel={taggedChannel}
          latencyProfile={mode}
          onBalancedUnavailable={handleBalancedUnavailable}
          onUltraLowFailure={handleUltraLowFailure}
          onUltraLowUnavailable={handleUltraLowUnavailable}
          profileExitReason={modeExitReason}
        />
      )}
    </div>
  )
}
