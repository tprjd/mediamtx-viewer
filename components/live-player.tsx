'use client'

import { Gauge, Scale, ShieldCheck } from 'lucide-react'
import { useMemo } from 'react'

import {
  HlsPlayer,
  isHlsJsSupported,
} from '@/components/hls-player'
import { Button } from '@/components/ui/button'
import { usePlaybackMode } from '@/components/use-playback-mode'
import { WebRtcPlayer } from '@/components/webrtc-player'
import { hlsPlaybackContract } from '@/lib/streaming-contract'
import type { PublicChannel } from '@/lib/types'

interface LivePlayerProps {
  channel: PublicChannel
  viewerId?: string
}

const VIEWER_QUERY_PARAMETER = 'frankerzspam_viewer'
const ultraLowContract = hlsPlaybackContract('ultra-low')

function tagPlaybackUrl(url: string, viewerId: string | undefined): string {
  if (!viewerId) return url

  const [withoutHash, hash] = url.split('#', 2)
  const separator = withoutHash.includes('?') ? '&' : '?'
  const query = `${VIEWER_QUERY_PARAMETER}=${encodeURIComponent(viewerId)}`
  return `${withoutHash}${separator}${query}${hash === undefined ? '' : `#${hash}`}`
}

export function LivePlayer({ channel, viewerId }: LivePlayerProps) {
  const playback = usePlaybackMode({
    live: channel.status.live,
    preferredPlayback: channel.preferredPlayback,
    streamStartedAt: channel.status.startedAt,
    supportsUltraLow: isHlsJsSupported,
  })
  const {
    balancedUnavailable,
    lowLatencyDisabled,
    mode,
    modeExitReason,
    onBalancedUnavailable: handleBalancedUnavailable,
    onUltraLowFailure: handleUltraLowFailure,
    onUltraLowUnavailable: handleUltraLowUnavailable,
    onWebRtcFallback: handleFallback,
    retrySeconds,
    selectMode,
    ultraLowSupported,
    ultraLowUnavailableReason,
  } = playback
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
