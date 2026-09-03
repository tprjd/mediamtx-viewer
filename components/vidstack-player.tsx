'use client'

import {
  Controls,
  FullscreenButton,
  isHLSProvider,
  isVideoProvider,
  LiveButton,
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
  Maximize,
  Minimize,
  Pause,
  PictureInPicture,
  Play,
  Radio,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef } from 'react'

export type VidstackProviderKind = 'hls' | 'native' | null

interface VidstackPlayerProps {
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
  seekBackward: null,
  seekForward: null,
  slowDown: null,
  speedUp: null,
}

function PlayerPoster({ poster }: { poster?: string | null }) {
  const started = useMediaState('started')

  if (!poster || started) return null

  return <Poster alt="" className="media-poster" />
}

function PlayerControls({ seekableLive }: { seekableLive: boolean }) {
  const fullscreen = useMediaState('fullscreen')
  const muted = useMediaState('muted')
  const paused = useMediaState('paused')

  return (
    <Controls.Root className="media-controls" hideDelay={2_000}>
      <Controls.Group className="media-controls-group">
        <PlayButton
          aria-label={paused ? 'Play video' : 'Pause video'}
          className="media-control-button"
          title={paused ? 'Play' : 'Pause'}
        >
          {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        </PlayButton>

        <MuteButton
          aria-label={muted ? 'Unmute video' : 'Mute video'}
          className="media-control-button"
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </MuteButton>

        <VolumeSlider.Root
          aria-label="Volume"
          className="media-volume-slider"
          title="Volume"
        >
          <VolumeSlider.Track className="media-slider-track">
            <VolumeSlider.TrackFill className="media-slider-fill" />
          </VolumeSlider.Track>
          <VolumeSlider.Thumb className="media-slider-thumb" />
        </VolumeSlider.Root>

        <span className="media-controls-spacer" />

        {seekableLive ? (
          <LiveButton className="media-live-button" title="Jump to live edge">
            <Radio aria-hidden="true" />
            Live
          </LiveButton>
        ) : (
          <span className="media-live-label">
            <Radio aria-hidden="true" />
            Live
          </span>
        )}

        <PIPButton
          aria-label="Toggle picture in picture"
          className="media-control-button"
          title="Picture in picture"
        >
          <PictureInPicture aria-hidden="true" />
        </PIPButton>

        <FullscreenButton
          aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          className="media-control-button"
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
      className="media-player"
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
      {children}
      <PlayerControls seekableLive={seekableLive} />
      <MediaAnnouncer />
    </MediaPlayer>
  )
}
