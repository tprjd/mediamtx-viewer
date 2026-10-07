'use client'

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as RadioGroup from '@radix-ui/react-radio-group'
import { Check, Gauge, Scale, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useMemo, useState } from 'react'
import styles from './live-player.module.css'

import {
  HlsPlayer,
  isHlsJsSupported,
} from '@/components/hls-player'
import { Tooltip } from '@/components/ui/tooltip'
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
  summaryTarget: (target: HTMLDivElement | null) => void
  selectableModes: ReturnType<typeof usePlaybackMode>['selectableModes']
  mode: PlaybackMode
  modeExitReason?: string
  selectMode: ReturnType<typeof usePlaybackMode>['selectMode']
}

export function PlaybackModeControls({
  summaryTarget,
  selectableModes,
  mode,
  modeExitReason,
  selectMode,
}: PlaybackModeControlsProps) {
  const modes: Record<PlaybackMode, {
    label: string
    accessibleLabel?: string
    description: string
    icon: typeof Gauge
  }> = {
    'ultra-low': {
      label: 'Low',
      accessibleLabel: `${ultraLowContract.label}, recommended`,
      description: `Targets about ${ultraLowContract.targetLatencySeconds}s behind live and adapts to the stream. Recommended for low delay. Try Balanced or Smooth if playback stalls.`,
      icon: Gauge,
    },
    'balanced': {
      label: 'Balanced',
      description: `Targets about ${hlsPlaybackContract('balanced').targetLatencySeconds}s behind live. Balances delay with room to recover from brief connection drops.`,
      icon: Scale,
    },
    'smooth': {
      label: 'Smooth',
      description: `Targets about ${hlsPlaybackContract('smooth').targetLatencySeconds}s behind live. Adds more buffer for unstable connections.`,
      icon: ShieldCheck,
    },
    'webrtc': {
      label: 'Low latency',
      description: 'Uses WebRTC for minimal delay, with no fixed delay target and less room to recover from connection drops.',
      icon: Gauge,
    },
  }
  const availableModes = selectableModes.map(value => ({ value, ...modes[value] }))
  const currentMode = modes[mode]

  return (
    <div className={styles.playbackModeSwitch}>
      <div ref={summaryTarget} className={styles.playbackSummaryTarget} />
      <RadioGroup.Root
        aria-label="Playback mode"
        className={styles.playbackModeActions}
        orientation="horizontal"
        value={mode}
        onValueChange={selectMode}
      >
        {availableModes.map(({ value, label, accessibleLabel, description, icon: Icon }) => (
          <Tooltip
            key={value}
            content={
              <span className={styles.playbackModeTooltip}>
                {description}
                {value === mode && modeExitReason && <span>{modeExitReason}</span>}
              </span>
            }
          >
            <RadioGroup.Item
              aria-label={accessibleLabel}
              className={styles.playbackModeOption}
              value={value}
            >
              <Icon aria-hidden="true" />
              {label}
            </RadioGroup.Item>
          </Tooltip>
        ))}
      </RadioGroup.Root>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className={styles.playbackModeTrigger}
            aria-label={`Playback mode: ${currentMode?.label ?? mode}`}
          >
            <SlidersHorizontal aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={styles.playbackModeMenu}
            align="end"
            sideOffset={8}
            collisionPadding={12}
            aria-label="Playback mode"
          >
            <DropdownMenu.Label className={styles.playbackModeMenuLabel}>
              Playback mode
            </DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={mode} onValueChange={selectMode}>
              {availableModes.map(({ value, label, accessibleLabel, description, icon: Icon }) => (
                <DropdownMenu.RadioItem
                  key={value}
                  value={value}
                  aria-label={accessibleLabel ?? label}
                  className={styles.playbackModeMenuOption}
                  data-mode={value}
                >
                  <Icon aria-hidden="true" />
                  <span className={styles.playbackModeMenuCopy}>
                    <span>{label}</span>
                    <small>{description}</small>
                  </span>
                  <DropdownMenu.ItemIndicator className={styles.playbackModeMenuCheck}>
                    <Check aria-hidden="true" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {modeExitReason && <span className="sr-only" role="status">{modeExitReason}</span>}
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
  const [summaryTarget, setSummaryTarget] = useState<HTMLDivElement | null>(null)
  const playback = usePlaybackMode({
    live: channel.status.live,
    preferredPlayback: channel.preferredPlayback,
    streamStartedAt: channel.status.startedAt,
    supportsUltraLow: isHlsJsSupported,
    tracks: channel.status.tracks,
  })
  const {
    selectableModes,
    mode,
    modeExitReason,
    onBalancedUnavailable: handleBalancedUnavailable,
    onUltraLowFailure: handleUltraLowFailure,
    onUltraLowUnavailable: handleUltraLowUnavailable,
    onWebRtcFallback: handleFallback,
    selectMode,
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
      summaryTarget={setSummaryTarget}
      selectableModes={selectableModes}
      mode={mode}
      modeExitReason={modeExitReason}
      selectMode={selectMode}
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
          summaryTarget={channel.status.live ? summaryTarget : null}
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
          summaryTarget={channel.status.live ? summaryTarget : null}
          onOpenChat={onOpenChat}
          onTheaterModeChange={onTheaterModeChange}
          theaterChatRestoreRef={theaterChatRestoreRef}
          theaterMode={theaterMode}
        />
      )}
    </div>
  )
}
