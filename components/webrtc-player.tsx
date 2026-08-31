'use client'

import { AlertTriangle, LoaderCircle, Radio, Waves } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { PlaybackStats } from '@/components/playback-stats'
import { authClient } from '@/lib/auth/client'
import type { PublicChannel } from '@/lib/types'

type PlaybackState = 'loading' | 'playing' | 'reconnecting' | 'unauthorized' | 'error'

interface ReaderOptions {
  url: string
  onError?: (error: string) => void
  onTrack?: (event: RTCTrackEvent) => void
  onDataChannel?: (event: RTCDataChannelEvent) => void
}

interface MediaMtxReader {
  close(): void
}

interface MediaMtxReaderConstructor {
  new (options: ReaderOptions): MediaMtxReader
}

declare global {
  interface Window {
    MediaMTXWebRTCReader?: MediaMtxReaderConstructor
  }
}

let readerScriptPromise: Promise<MediaMtxReaderConstructor> | undefined

function loadReader(): Promise<MediaMtxReaderConstructor> {
  if (window.MediaMTXWebRTCReader) {
    return Promise.resolve(window.MediaMTXWebRTCReader)
  }

  if (readerScriptPromise) return readerScriptPromise

  const promise = new Promise<MediaMtxReaderConstructor>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-mediamtx-reader]',
    )
    const script = existing ?? document.createElement('script')

    const loaded = () => {
      if (window.MediaMTXWebRTCReader) {
        resolve(window.MediaMTXWebRTCReader)
      } else {
        reject(new Error('MediaMTX WebRTC reader did not initialize'))
      }
    }

    script.addEventListener('load', loaded, { once: true })
    script.addEventListener(
      'error',
      () => reject(new Error('Unable to load the MediaMTX WebRTC reader')),
      { once: true },
    )

    if (!existing) {
      script.src = '/media/whep/reader.js'
      script.async = true
      script.dataset.mediamtxReader = 'true'
      document.head.appendChild(script)
    }
  }).catch((error) => {
    readerScriptPromise = undefined
    throw error
  })

  readerScriptPromise = promise
  return promise
}

interface WebRtcPlayerProps {
  channel: PublicChannel
  onFallback: () => void
}

export function WebRtcPlayer({ channel, onFallback }: WebRtcPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fallbackRef = useRef(onFallback)
  const sourceHasAudioRef = useRef(false)
  const [playbackState, setPlaybackState] = useState<PlaybackState>('loading')
  const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(
    null,
  )
  const status = channel.status
  const sourceHasAudio = status.tracks.some((track) =>
    /audio|aac|opus|g7/i.test(track),
  )

  useEffect(() => {
    fallbackRef.current = onFallback
    sourceHasAudioRef.current = sourceHasAudio
  }, [onFallback, sourceHasAudio])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let active = true
    let reader: MediaMtxReader | undefined
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined
    let audioTimer: ReturnType<typeof setTimeout> | undefined

    setPeerConnection(null)

    const clearMedia = () => {
      video.pause()
      video.srcObject = null
    }

    if (!status.live) {
      clearMedia()
      return
    }

    const scheduleFallback = (delay = 6_000) => {
      clearTimeout(fallbackTimer)
      fallbackTimer = setTimeout(() => {
        if (active) fallbackRef.current()
      }, delay)
    }

    const handlePlaying = () => {
      clearTimeout(fallbackTimer)
      setPlaybackState('playing')
    }

    video.addEventListener('playing', handlePlaying)

    void loadReader()
      .then((Reader) => {
        if (!active) return

        reader = new Reader({
          url: new URL(channel.playback.webrtc, window.location.href).href,
          onError: () => {
            if (!active) return
            setPlaybackState('reconnecting')
            void authClient.getSession().then(({ data }) => {
              if (!active) return
              if (!data) {
                reader?.close()
                clearTimeout(fallbackTimer)
                setPlaybackState('unauthorized')
                return
              }
              scheduleFallback()
            })
          },
          onTrack: (event) => {
            if (!active) return

            const eventTarget = event.currentTarget
            if (eventTarget && 'getStats' in eventTarget) {
              setPeerConnection(eventTarget as RTCPeerConnection)
            }

            const stream = event.streams[0]
            if (!stream) return

            if (video.srcObject !== stream) {
              video.srcObject = stream
            }
            void video.play().catch(() => {
              // The native controls remain available if autoplay is blocked.
            })

            clearTimeout(audioTimer)
            if (sourceHasAudioRef.current) {
              audioTimer = setTimeout(() => {
                if (active && stream.getAudioTracks().length === 0) {
                  fallbackRef.current()
                }
              }, 2_000)
            }
          },
        })

        scheduleFallback(8_000)
      })
      .catch(() => {
        if (!active) return
        setPlaybackState('error')
        scheduleFallback(2_000)
      })

    return () => {
      active = false
      clearTimeout(fallbackTimer)
      clearTimeout(audioTimer)
      video.removeEventListener('playing', handlePlaying)
      reader?.close()
      clearMedia()
    }
  }, [channel.playback.webrtc, status.live])

  const offline = !status.live
  const playing = !offline && playbackState === 'playing'

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

        {playing && (
          <span className="protocol-badge">
            <Waves className="size-3" aria-hidden="true" />
            WebRTC · Low latency
          </span>
        )}

        {!playing && (
          <div className="player-overlay" aria-live="polite">
            {offline ? (
              <div className="player-message">
                <span className="player-icon">
                  <Radio className="size-6" aria-hidden="true" />
                </span>
                <h2>Stream offline</h2>
                <p>This page will start checking again automatically.</p>
              </div>
            ) : playbackState === 'unauthorized' ? (
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
            ) : playbackState === 'error' ? (
              <div className="player-message">
                <span className="player-icon player-icon-warning">
                  <AlertTriangle className="size-6" aria-hidden="true" />
                </span>
                <h2>Low-latency playback unavailable</h2>
                <p>Switching to the more compatible HLS stream…</p>
                <Button onClick={onFallback} size="sm" variant="secondary">
                  Use HLS now
                </Button>
              </div>
            ) : (
              <div className="player-message">
                <span className="player-icon">
                  <LoaderCircle
                    className="size-6 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                </span>
                <h2>
                  {playbackState === 'loading'
                    ? 'Starting low-latency stream'
                    : 'Reconnecting'}
                </h2>
                <p>
                  WebRTC is connecting. HLS will take over automatically if it
                  cannot connect.
                </p>
                <Button onClick={onFallback} size="sm" variant="ghost">
                  Use compatibility mode
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <PlaybackStats
        peerConnection={peerConnection}
        playing={playing}
        protocol="WebRTC"
        tracks={status.tracks}
        videoRef={videoRef}
      />
    </div>
  )
}
