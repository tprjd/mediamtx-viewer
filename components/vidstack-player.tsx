'use client'

import styles from './vidstack-player.module.css'

import {
  Controls,
  FullscreenButton,
  isHLSProvider,
  isVideoProvider,
  LiveButton,
  MEDIA_KEY_SHORTCUTS,
  MediaAnnouncer,
  MediaPlayer,
  MediaProvider,
  MuteButton,
  PIPButton,
  PlayButton,
  Poster,
  VolumeSlider,
  useMediaState,
  type MediaProviderAdapter,
  type MediaStreamType,
  type PlayerSrc,
} from '@vidstack/react'
import Hls, { type HlsConfig } from 'hls.js'
import {
  Expand,
  Maximize,
  MessageSquare,
  Minimize,
  Pause,
  PictureInPicture,
  Play,
  Radio,
  Shrink,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef } from 'react'

export type VidstackProviderKind = 'hls' | 'native' | null

export interface PlayerTheaterProps {
  chatOpen?: boolean
  onOpenChat?: () => void
  onTheaterModeChange?: (theaterMode: boolean) => void
  theaterChatRestoreRef?: (element: HTMLButtonElement | null) => void
  theaterMode?: boolean
}

interface VidstackPlayerProps extends PlayerTheaterProps {
  ariaLabel: string
  children?: ReactNode
  hlsConfig?: Partial<HlsConfig>
  liveEdgeTolerance?: number
  onHlsInstanceChange?: (instance: Hls | null) => void
  onProviderKindChange?: (kind: VidstackProviderKind) => void
  onUserPauseChange?: (paused: boolean) => void
  onVideoElementChange?: (video: HTMLVideoElement | null) => void
  poster?: string | null
  seekableLive?: boolean
  src?: PlayerSrc
  streamType?: MediaStreamType
}

const LIVE_KEY_SHORTCUTS = {
  ...MEDIA_KEY_SHORTCUTS,
  seekBackward: null,
  seekForward: null,
  slowDown: null,
  speedUp: null,
}

function PlayerPoster({ poster }: { poster?: string | null }) {
  const started = useMediaState('started')

  if (!poster || started) return null

  return <Poster alt="" className={`${styles.mediaPoster}`} />
}

function PlayerControls({
  onTheaterModeChange,
  seekableLive,
  theaterMode = false,
}: Pick<PlayerTheaterProps, 'onTheaterModeChange' | 'theaterMode'> & {
  seekableLive: boolean
}) {
  const fullscreen = useMediaState('fullscreen')
  const muted = useMediaState('muted')
  const paused = useMediaState('paused')

  return (
    <Controls.Root
      className={`${styles.mediaControls}`}
      data-player-controls="true"
      hideDelay={2_000}
    >
      <Controls.Group className={`${styles.mediaControlsGroup}`}>
        <PlayButton
          aria-label={paused ? 'Play video' : 'Pause video'}
          className={`${styles.mediaControlButton}`}
          title={paused ? 'Play' : 'Pause'}
        >
          {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        </PlayButton>

        <MuteButton
          aria-label={muted ? 'Unmute video' : 'Mute video'}
          className={`${styles.mediaControlButton}`}
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </MuteButton>

        <VolumeSlider.Root
          aria-label="Volume"
          className={`${styles.mediaVolumeSlider}`}
          title="Volume"
        >
          <VolumeSlider.Track className={`${styles.mediaSliderTrack}`}>
            <VolumeSlider.TrackFill className={`${styles.mediaSliderFill}`} />
          </VolumeSlider.Track>
          <VolumeSlider.Thumb className={`${styles.mediaSliderThumb}`} />
        </VolumeSlider.Root>

        <span className={`${styles.mediaControlsSpacer}`} />

        {seekableLive ? (
          <LiveButton className={`${styles.mediaLiveButton}`} title="Jump to live edge">
            <Radio aria-hidden="true" />
            Live
          </LiveButton>
        ) : (
          <span className={`${styles.mediaLiveLabel}`}>
            <Radio aria-hidden="true" />
            Live
          </span>
        )}

        {onTheaterModeChange && (
          <button
            aria-label={theaterMode ? 'Exit theater mode' : 'Enter theater mode'}
            className={`${styles.mediaControlButton}`}
            onClick={() => onTheaterModeChange(!theaterMode)}
            title={theaterMode ? 'Exit theater mode' : 'Theater mode'}
            type="button"
          >
            {theaterMode ? (
              <Shrink aria-hidden="true" />
            ) : (
              <Expand aria-hidden="true" />
            )}
          </button>
        )}

        <PIPButton
          aria-label="Toggle picture in picture"
          className={`${styles.mediaControlButton}`}
          title="Picture in picture"
        >
          <PictureInPicture aria-hidden="true" />
        </PIPButton>

        <FullscreenButton
          aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          className={`${styles.mediaControlButton}`}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? (
            <Minimize aria-hidden="true" />
          ) : (
            <Maximize aria-hidden="true" />
          )}
        </FullscreenButton>
      </Controls.Group>
    </Controls.Root>
  )
}

function TheaterChatRestore({
  onOpenChat,
  theaterChatRestoreRef,
}: Pick<PlayerTheaterProps, 'onOpenChat' | 'theaterChatRestoreRef'>) {
  if (!onOpenChat) return null

  return (
    <div className={styles.theaterChatRestore}>
      <button
        aria-label="Open Chat"
        data-theater-chat-restore="true"
        onClick={onOpenChat}
        ref={theaterChatRestoreRef}
        type="button"
      >
        <MessageSquare aria-hidden="true" />
        <span>Open chat</span>
      </button>
    </div>
  )
}

export function VidstackPlayer({
  ariaLabel,
  children,
  hlsConfig,
  liveEdgeTolerance = 2,
  onHlsInstanceChange,
  onProviderKindChange,
  onUserPauseChange,
  onVideoElementChange,
  poster,
  seekableLive = false,
  src,
  streamType = 'live',
  chatOpen = true,
  onOpenChat,
  onTheaterModeChange,
  theaterChatRestoreRef,
  theaterMode = false,
}: VidstackPlayerProps) {
  const disposeHlsInstanceRef = useRef<(() => void) | undefined>(undefined)

  const handleProviderChange = useCallback(
    (provider: MediaProviderAdapter | null) => {
      disposeHlsInstanceRef.current?.()
      disposeHlsInstanceRef.current = undefined
      onHlsInstanceChange?.(null)

      if (provider && isHLSProvider(provider)) {
        provider.library = Hls
        provider.config = hlsConfig ?? {}
        onProviderKindChange?.('hls')
        onVideoElementChange?.(provider.video)
        disposeHlsInstanceRef.current = provider.onInstance((instance) => {
          onHlsInstanceChange?.(instance as Hls)
        })
        return
      }

      if (provider && isVideoProvider(provider)) {
        onProviderKindChange?.('native')
        onVideoElementChange?.(provider.video)
        return
      }

      onProviderKindChange?.(null)
      onVideoElementChange?.(null)
    },
    [hlsConfig, onHlsInstanceChange, onProviderKindChange, onVideoElementChange],
  )

  useEffect(
    () => () => {
      disposeHlsInstanceRef.current?.()
      onHlsInstanceChange?.(null)
      onProviderKindChange?.(null)
      onVideoElementChange?.(null)
    }, [onHlsInstanceChange, onProviderKindChange, onVideoElementChange],
  )

  return (
    <MediaPlayer
      ariaLabel={ariaLabel}
      autoPlay
      className={`${styles.mediaPlayer}`}
      keyShortcuts={LIVE_KEY_SHORTCUTS}
      keyTarget="document"
      liveEdgeTolerance={liveEdgeTolerance}
      load="eager"
      muted
      onMediaPauseRequest={() => onUserPauseChange?.(true)}
      onMediaPlayRequest={() => onUserPauseChange?.(false)}
      onProviderChange={handleProviderChange}
      playsInline
      poster={poster ?? ''}
      src={src}
      streamType={streamType}
      viewType="video"
    >
      <MediaProvider />
      <PlayerPoster poster={poster} />
      {theaterMode && !chatOpen && (
        <TheaterChatRestore
          onOpenChat={onOpenChat}
          theaterChatRestoreRef={theaterChatRestoreRef}
        />
      )}
      {children}
      <PlayerControls
        onTheaterModeChange={onTheaterModeChange}
        seekableLive={seekableLive}
        theaterMode={theaterMode}
      />
      <MediaAnnouncer />
    </MediaPlayer>
  )
}
