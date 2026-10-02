'use client'

import * as RadioGroup from '@radix-ui/react-radio-group'
import { Gauge, Scale, ShieldCheck } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useId, useMemo } from 'react'
import styles from './live-player.module.css'

import {
  HlsPlayer,
  isHlsJsSupported,
} from '@/components/hls-player'
import { usePlaybackMode } from '@/components/use-playback-mode'
import { WebRtcPlayer } from '@/components/webrtc-player'
import type { PlayerTheaterProps } from '@/components/vidstack-player'
import { hlsPlaybackContract, type PlaybackMode } from '@/lib/streaming-contract'
import type { PublicChannel } from '@/lib/types'

interface LivePlayerProps extends PlayerTheaterProps {
  channel: PublicChannel
  playbackControlsTarget?: HTMLElement | null
  playbackStatsTarget?: HTMLElement | null
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

interface PlaybackModeControlsProps {
  balancedUnavailable: boolean
  lowLatencyDisabled: boolean
  mode: PlaybackMode
  modeExitReason?: string
  selectMode: ReturnType<typeof usePlaybackMode>['selectMode']
  ultraLowSupported: boolean
  webrtcAvailable: boolean
}

export function PlaybackModeControls({
  balancedUnavailable,
  lowLatencyDisabled,
  mode,
  modeExitReason,
  selectMode,
  ultraLowSupported,
  webrtcAvailable,
}: PlaybackModeControlsProps) {
  const labelId = useId()
  const descriptionId = useId()
  const modes: { value: PlaybackMode; label: string; accessibleLabel?: string; available: boolean; icon: typeof Gauge }[] = [
    { value: 'ultra-low', label: 'Low', accessibleLabel: ultraLowContract.label, available: ultraLowSupported, icon: Gauge },
    { value: 'balanced', label: 'Balanced', available: !balancedUnavailable, icon: Scale },
    { value: 'smooth', label: 'Smooth', available: true, icon: ShieldCheck },
    { value: 'webrtc', label: 'Low latency', available: webrtcAvailable && !lowLatencyDisabled, icon: Gauge },
  ]
  const availableModes = modes.filter((option) => option.available)

  return (
    <div className={styles.playbackModeSwitch}>
      <strong id={labelId}>Playback mode</strong>
      <RadioGroup.Root
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        className={styles.playbackModeActions}
        orientation="horizontal"
        value={mode}
        onValueChange={(value) => {
          const selected = availableModes.find((option) => option.value === value)
          if (selected) selectMode(selected.value)
        }}
      >
        {availableModes.map(({ value, label, accessibleLabel, icon: Icon }) => (
          <RadioGroup.Item
            aria-label={accessibleLabel}
            className={styles.playbackModeOption}
            key={value}
            title={value === 'ultra-low' ? 'Experimental HLS mode' : undefined}
            value={value}
          >
            <Icon aria-hidden="true" />
            {label}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      <span
        className={styles.playbackModeDescription}
        id={descriptionId}
        role={modeExitReason ? 'status' : undefined}
      >
        {modeExitReason ?? (
          <>
            {mode === 'ultra-low' && 'Experimental HLS · shortest buffer.'}
            {mode === 'balanced' && 'Lower delay with moderate recovery margin.'}
            {mode === 'smooth' && 'Extra recovery margin for unstable connections.'}
            {mode === 'webrtc' && 'Lowest delay with less recovery margin.'}
          </>
        )}
      </span>
    </div>
  )
}

export function LivePlayer({
  channel,
  chatOpen,
  onOpenChat,
  onTheaterModeChange,
  playbackControlsTarget,
  playbackStatsTarget,
  theaterChatRestoreRef,
  theaterMode,
  viewerId,
}: LivePlayerProps) {
  const playback = usePlaybackMode({
    live: channel.status.live,
    preferredPlayback: channel.preferredPlayback,
    streamStartedAt: channel.status.startedAt,
    supportsUltraLow: isHlsJsSupported,
    tracks: channel.status.tracks,
  })
  const {
    balancedUnavailable,
    lowLatencyDisabled,
    mode,
    modeExitReason,
    webrtcAvailable,
    onBalancedUnavailable: handleBalancedUnavailable,
    onUltraLowFailure: handleUltraLowFailure,
    onUltraLowUnavailable: handleUltraLowUnavailable,
    onWebRtcFallback: handleFallback,
    selectMode,
    ultraLowSupported,
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
  const playbackModeControls = channel.status.live ? (
    <PlaybackModeControls
      balancedUnavailable={balancedUnavailable}
      lowLatencyDisabled={lowLatencyDisabled}
      mode={mode}
      modeExitReason={modeExitReason}
      selectMode={selectMode}
      ultraLowSupported={ultraLowSupported}
      webrtcAvailable={webrtcAvailable}
    />
  ) : null
  const hasExternalControlsTarget = playbackControlsTarget !== undefined
  const hasExternalStatsTarget = playbackStatsTarget !== undefined
  const showStats =
    channel.status.live &&
    (!hasExternalStatsTarget || playbackStatsTarget !== null)

  return (
    <div className="live-player">
      {playbackModeControls &&
        (hasExternalControlsTarget
          ? playbackControlsTarget
            ? createPortal(playbackModeControls, playbackControlsTarget)
            : null
          : playbackModeControls)}

      {mode === 'webrtc' ? (
        <WebRtcPlayer
          channel={taggedChannel}
          chatOpen={chatOpen}
          onFallback={handleFallback}
          onOpenChat={onOpenChat}
          onTheaterModeChange={onTheaterModeChange}
          showStats={showStats}
          statsTarget={playbackStatsTarget}
          theaterChatRestoreRef={theaterChatRestoreRef}
          theaterMode={theaterMode}
        />
      ) : (
        <HlsPlayer
          channel={taggedChannel}
          chatOpen={chatOpen}
          latencyProfile={mode}
          onBalancedUnavailable={handleBalancedUnavailable}
          onUltraLowFailure={handleUltraLowFailure}
          onUltraLowUnavailable={handleUltraLowUnavailable}
          profileExitReason={modeExitReason}
          showStats={showStats}
          statsTarget={playbackStatsTarget}
          onOpenChat={onOpenChat}
          onTheaterModeChange={onTheaterModeChange}
          theaterChatRestoreRef={theaterChatRestoreRef}
          theaterMode={theaterMode}
        />
      )}
    </div>
  )
}
