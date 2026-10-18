'use client'

import { AlertTriangle, RotateCcw, ShieldCheck } from 'lucide-react'

import { PlaybackRunOverlay } from '@/components/playback-run-overlay'
import { Button } from '@/components/ui/button'
import { PlaybackStats } from '@/components/playback-stats'
import { VidstackPlayer, type PlayerTheaterProps } from '@/components/vidstack-player'
import { useHlsPlayback, type HlsPlaybackOptions } from '@/components/use-hls-playback'

interface HlsPlayerProps extends PlayerTheaterProps, HlsPlaybackOptions {
  showStats?: boolean
  statsTarget?: HTMLElement | null
  summaryTarget?: HTMLElement | null
}

export function HlsPlayer({
  chatOpen,
  channel,
  latencyProfile,
  onBalancedUnavailable,
  onUltraLowFailure,
  onUltraLowUnavailable,
  profileExitReason,
  showStats = true,
  statsTarget,
  summaryTarget,
  onOpenChat,
  onTheaterModeChange,
  theaterChatRestoreRef,
  theaterMode,
}: HlsPlayerProps) {
  const {
    playerKey,
    playerProps,
    state: visibleState,
    diagnostics: hlsDiagnostics,
    label,
    usingFallback,
    selectCompatibilityStream,
    retry,
    videoRef,
  } = useHlsPlayback({
    channel,
    latencyProfile,
    onBalancedUnavailable,
    onUltraLowFailure,
    onUltraLowUnavailable,
    profileExitReason,
  })

  return (
    <div className="player-frame">
      <div
        className="player-shell"
        style={{ '--accent': channel.accentColor } as React.CSSProperties}
      >
        <VidstackPlayer
          ariaLabel={`${channel.title} live video`}
          key={playerKey}
          {...playerProps}
          chatOpen={chatOpen}
          onOpenChat={onOpenChat}
          onTheaterModeChange={onTheaterModeChange}
          poster={channel.poster}
          theaterChatRestoreRef={theaterChatRestoreRef}
          theaterMode={theaterMode}
        >
          {visibleState === 'playing' && (
            <span className="protocol-badge">
              <ShieldCheck className="size-3" aria-hidden="true" />
              HLS · {label}
            </span>
          )}

          <PlaybackRunOverlay
            channelSlug={channel.slug}
            loadingDescription={`Preparing ${label.toLowerCase()} playback…`}
            loadingTitle="Joining stream"
            reconnectingDescription="The connection was interrupted. Retrying automatically…"
            state={visibleState}
          >
            {visibleState === 'unsupported' && (
              <div className="player-message">
                <span className="player-icon player-icon-warning">
                  <AlertTriangle className="size-6" aria-hidden="true" />
                </span>
                <h2>Video format not supported</h2>
                <p>
                  {usingFallback
                    ? 'The compatibility stream is also unavailable on this browser or device.'
                    : 'This stream may use AV1, which is not available on every browser or device.'}
                </p>
                {channel.hasCompatibilityFallback && !usingFallback && (
                  <Button
                    onClick={selectCompatibilityStream}
                    size="sm"
                    variant="secondary"
                  >
                    Try compatibility stream
                  </Button>
                )}
              </div>
            )}

            {visibleState === 'error' && (
              <div className="player-message">
                <span className="player-icon player-icon-warning">
                  <AlertTriangle className="size-6" aria-hidden="true" />
                </span>
                <h2>Playback interrupted</h2>
                <p>The stream is live, but the player could not continue.</p>
                <Button onClick={retry} size="sm" variant="secondary">
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Try again
                </Button>
              </div>
            )}
          </PlaybackRunOverlay>
        </VidstackPlayer>
      </div>

      {(showStats || summaryTarget) && (
        <PlaybackStats
          hlsDiagnostics={hlsDiagnostics}
          playing={visibleState === 'playing'}
          protocol="HLS"
          showStats={showStats}
          statsTarget={statsTarget}
          summaryTarget={summaryTarget}
          tracks={channel.status.tracks}
          videoRef={videoRef}
        />
      )}
    </div>
  )
}
