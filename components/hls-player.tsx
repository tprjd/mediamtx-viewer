'use client'

import Hls, { ErrorDetails, ErrorTypes } from 'hls.js'
import {
  AlertTriangle,
  LoaderCircle,
  Radio,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { PlaybackStats } from '@/components/playback-stats'
import { authClient } from '@/lib/auth/client'
import type { PublicChannel } from '@/lib/types'

type PlaybackState =
  | 'offline'
  | 'loading'
  | 'playing'
  | 'reconnecting'
  | 'unauthorized'
  | 'unsupported'
  | 'error'

interface HlsPlayerProps {
  channel: PublicChannel
}

function isCodecError(details: ErrorDetails): boolean {
  return details.toLowerCase().includes('codec')
}

export function HlsPlayer({ channel }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const recoveryRef = useRef({ attempts: 0 })
  const [playbackState, setPlaybackState] = useState<Exclude<PlaybackState, 'offline'>>(
    'loading',
  )
  const [reloadKey, setReloadKey] = useState(0)
  const [usingFallback, setUsingFallback] = useState(false)
  const status = channel.status
  const sourceUrl =
    usingFallback && channel.playback.fallbackHls
      ? channel.playback.fallbackHls
      : channel.playback.hls

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let active = true
    let hls: Hls | undefined
    let unsupportedTimer: ReturnType<typeof setTimeout> | undefined
    let codecErrorTimer: ReturnType<typeof setTimeout> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let stableTimer: ReturnType<typeof setTimeout> | undefined
    let mediaRecoveryAttempted = false
    let softRecoveryAttempted = false
    let stagnantSamples = 0
    let lastProgress: number | undefined
    let everPlayed = false
    let needsRecovery = false

    const resetVideo = () => {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }

    if (!status.live) {
      resetVideo()
      return
    }

    const canRecover = () =>
      active &&
      status.live &&
      document.visibilityState === 'visible' &&
      navigator.onLine !== false &&
      !(everPlayed && video.paused && !video.ended)

    const scheduleRecreate = (immediate = false) => {
      needsRecovery = true
      setPlaybackState('reconnecting')
      clearTimeout(retryTimer)
      if (!canRecover()) return

      const attempt = recoveryRef.current.attempts
      const delay = immediate ? 0 : Math.min(1_000 * 2 ** attempt, 15_000)
      recoveryRef.current.attempts = Math.min(attempt + 1, 8)
      retryTimer = setTimeout(() => {
        if (canRecover()) setReloadKey((key) => key + 1)
      }, delay)
    }

    const readProgress = () => {
      try {
        const quality = video.getVideoPlaybackQuality?.()
        if (quality && quality.totalVideoFrames > 0) {
          return quality.totalVideoFrames
        }
      } catch {
        // Fall back to the media clock on browsers with partial support.
      }
      return video.currentTime * 1_000
    }

    const pollProgress = () => {
      if (!canRecover() || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        stagnantSamples = 0
        lastProgress = undefined
        return
      }

      const progress = readProgress()
      if (lastProgress === undefined || progress > lastProgress) {
        lastProgress = progress
        stagnantSamples = 0
        return
      }

      stagnantSamples += 1
      if (stagnantSamples < 5) return
      stagnantSamples = 0
      setPlaybackState('reconnecting')

      if (hls && !softRecoveryAttempted) {
        softRecoveryAttempted = true
        const liveEdge = hls.liveSyncPosition
        if (liveEdge !== null && liveEdge !== undefined) {
          video.currentTime = liveEdge
        }
        hls.startLoad()
        return
      }

      scheduleRecreate()
    }

    const handleLoadStart = () => {
      if (!everPlayed) setPlaybackState('loading')
    }
    const handlePlaying = () => {
      clearTimeout(codecErrorTimer)
      clearTimeout(stableTimer)
      everPlayed = true
      needsRecovery = false
      stagnantSamples = 0
      lastProgress = readProgress()
      setPlaybackState('playing')
      stableTimer = setTimeout(() => {
        recoveryRef.current.attempts = 0
        mediaRecoveryAttempted = false
        softRecoveryAttempted = false
      }, 60_000)
    }
    const handleWaiting = () => {
      if (!video.paused) {
        needsRecovery = true
        setPlaybackState('reconnecting')
      }
    }
    const handlePause = () => {
      stagnantSamples = 0
      lastProgress = undefined
    }
    const handleVideoError = () => {
      void authClient.getSession().then(({ data }) => {
        if (!active) return
        if (!data) {
          clearTimeout(retryTimer)
          setPlaybackState('unauthorized')
        } else if (video.error?.code !== MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          scheduleRecreate()
        }
      })
      if (video.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        clearTimeout(codecErrorTimer)
        codecErrorTimer = setTimeout(() => {
          if (
            active &&
            (video.paused || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
          ) {
            setPlaybackState('unsupported')
          }
        }, 2_500)
      }
    }
    const handlePlay = () => {
      const liveEdge = hls?.liveSyncPosition
      if (
        liveEdge !== null &&
        liveEdge !== undefined &&
        liveEdge - video.currentTime > 2
      ) {
        video.currentTime = liveEdge
      }
    }

    video.addEventListener('loadstart', handleLoadStart)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('stalled', handleWaiting)
    video.addEventListener('pause', handlePause)
    video.addEventListener('error', handleVideoError)
    video.addEventListener('play', handlePlay)

    const resumeRecovery = () => {
      stagnantSamples = 0
      lastProgress = undefined
      if (needsRecovery && canRecover()) scheduleRecreate(true)
    }
    window.addEventListener('online', resumeRecovery)
    document.addEventListener('visibilitychange', resumeRecovery)
    const progressTimer = setInterval(pollProgress, 1_000)

    const beginPlayback = () => {
      void video.play().catch(() => {
        // Native controls remain available when autoplay policy blocks playback.
      })
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = sourceUrl
      video.load()
      beginPlayback()
    } else if (Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 30,
      })

      hls.on(Hls.Events.MANIFEST_PARSED, beginPlayback)
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return

        if (data.response?.code === 401 || data.response?.code === 403) {
          setPlaybackState('unauthorized')
          hls?.destroy()
          return
        }

        if (isCodecError(data.details)) {
          setPlaybackState('unsupported')
          hls?.destroy()
          return
        }

        if (data.type === ErrorTypes.NETWORK_ERROR) {
          scheduleRecreate()
          return
        }

        if (data.type === ErrorTypes.MEDIA_ERROR && !mediaRecoveryAttempted) {
          mediaRecoveryAttempted = true
          setPlaybackState('reconnecting')
          hls?.recoverMediaError()
          return
        }

        if (data.details === ErrorDetails.BUFFER_INCOMPATIBLE_CODECS_ERROR) {
          setPlaybackState('unsupported')
          hls?.destroy()
          return
        }

        scheduleRecreate()
      })

      hls.loadSource(sourceUrl)
      hls.attachMedia(video)
    } else {
      unsupportedTimer = setTimeout(() => setPlaybackState('unsupported'), 0)
    }

    return () => {
      active = false
      video.removeEventListener('loadstart', handleLoadStart)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('stalled', handleWaiting)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('error', handleVideoError)
      video.removeEventListener('play', handlePlay)
      window.removeEventListener('online', resumeRecovery)
      document.removeEventListener('visibilitychange', resumeRecovery)
      hls?.destroy()
      clearTimeout(unsupportedTimer)
      clearTimeout(codecErrorTimer)
      clearTimeout(retryTimer)
      clearTimeout(stableTimer)
      clearInterval(progressTimer)
      resetVideo()
    }
  }, [reloadKey, sourceUrl, status.live])

  const retry = () => setReloadKey((key) => key + 1)
  const visibleState: PlaybackState = status.live ? playbackState : 'offline'

  return (
    <div className="player-frame">
      <div
        className="player-shell"
        style={{ '--accent': channel.accentColor } as React.CSSProperties}
      >
        <video
          ref={videoRef}
          aria-label={`${channel.title} live video`}
          autoPlay
          className="size-full bg-black object-contain"
          controls
          muted
          playsInline
          poster={channel.poster}
        />

        {visibleState === 'playing' && (
          <span className="protocol-badge">
            <ShieldCheck className="size-3" aria-hidden="true" />
            HLS · Smooth
          </span>
        )}

        {visibleState !== 'playing' && (
          <div className="player-overlay" aria-live="polite">
          {visibleState === 'offline' && (
            <div className="player-message">
              <span className="player-icon">
                <Radio className="size-6" aria-hidden="true" />
              </span>
              <h2>Stream offline</h2>
              <p>This page will start checking again automatically.</p>
            </div>
          )}

          {(visibleState === 'loading' || visibleState === 'reconnecting') && (
            <div className="player-message">
              <span className="player-icon">
                <LoaderCircle
                  className="size-6 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              </span>
              <h2>
                {visibleState === 'loading' ? 'Joining stream' : 'Reconnecting'}
              </h2>
              <p>
                {visibleState === 'loading'
                  ? 'Preparing smooth playback…'
                  : 'The connection was interrupted. Retrying automatically…'}
              </p>
            </div>
          )}

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
                  onClick={() => setUsingFallback(true)}
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

          {visibleState === 'unauthorized' && (
            <div className="player-message">
              <span className="player-icon player-icon-warning">
                <AlertTriangle className="size-6" aria-hidden="true" />
              </span>
              <h2>Session expired</h2>
              <p>Sign in again to continue watching.</p>
              <Link
                className={buttonVariants({ size: 'sm', variant: 'secondary' })}
                href={`/login?returnTo=${encodeURIComponent(`/watch/${channel.slug}`)}`}
              >
                Sign in
              </Link>
            </div>
          )}
          </div>
        )}
      </div>

      <PlaybackStats
        playing={visibleState === 'playing'}
        protocol="HLS"
        tracks={status.tracks}
        videoRef={videoRef}
      />
    </div>
  )
}
