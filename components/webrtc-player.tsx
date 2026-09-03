'use client'

import { AlertTriangle, Waves } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { PlaybackRunOverlay } from '@/components/playback-run-overlay'
import { Button } from '@/components/ui/button'
import { PlaybackStats } from '@/components/playback-stats'
import { usePlaybackRun } from '@/components/use-playback-run'
import { VidstackPlayer } from '@/components/vidstack-player'
import { authClient } from '@/lib/auth/client'
import type { PublicChannel } from '@/lib/types'

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

type VideoFrameCallbackElement = Omit<
  HTMLVideoElement,
  'requestVideoFrameCallback'
> & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: VideoFrameCallbackMetadata) => void,
  ) => number
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
      script.src = '/vendor/mediamtx-reader-1.20.1.js'
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
  const fallbackRef = useRef(onFallback)
  const sourceHasAudioRef = useRef(false)
  const sourceHasVideoRef = useRef(false)
  const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(
    null,
  )
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null)
  const status = channel.status
  const {
    allowsAutomaticPlay,
    canRecover,
    onUserPauseChange,
    onVideoElementChange,
    playing,
    progress,
    setPhase: setPlaybackPhase,
    state: playbackState,
    videoElement,
    videoRef,
  } = usePlaybackRun(status.live)
  const sourceHasAudio = status.tracks.some((track) =>
    /audio|aac|opus|g7/i.test(track),
  )
  const sourceHasVideo = status.tracks.some(
    (track) => !/audio|aac|opus|g7|vorbis|pcma|pcmu/i.test(track),
  )
  const playerSource = useMemo(
    () =>
      mediaStream
        ? { src: mediaStream, type: 'video/object' as const }
        : undefined,
    [mediaStream],
  )
  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active) return
      if (!status.live) {
        setMediaStream(null)
      } else if (typeof MediaStream !== 'undefined') {
        setMediaStream((current) => current ?? new MediaStream())
      }
    })
    return () => {
      active = false
    }
  }, [status.live])

  useEffect(() => {
    fallbackRef.current = onFallback
    sourceHasAudioRef.current = sourceHasAudio
    sourceHasVideoRef.current = sourceHasVideo
  }, [onFallback, sourceHasAudio, sourceHasVideo])

  useEffect(() => {
    const video = videoElement
    const stream = mediaStream
    if (!video || !stream || !status.live) return

    let active = true
    let playPending = false
    let playRequested = false
    const resumeAttachedStream = () => {
      if (
        !active ||
        playPending ||
        playRequested ||
        !allowsAutomaticPlay() ||
        video.srcObject !== stream
      ) {
        return
      }

      playPending = true
      void video.play().then(
        () => {
          playPending = false
          playRequested = true
        },
        () => {
          playPending = false
        },
      )
    }
    const resumeTransportPause = () => {
      if (!allowsAutomaticPlay()) return
      playRequested = false
      resumeAttachedStream()
    }

    video.addEventListener('loadedmetadata', resumeAttachedStream)
    video.addEventListener('canplay', resumeAttachedStream)
    video.addEventListener('pause', resumeTransportPause)
    queueMicrotask(resumeAttachedStream)

    return () => {
      active = false
      video.removeEventListener('loadedmetadata', resumeAttachedStream)
      video.removeEventListener('canplay', resumeAttachedStream)
      video.removeEventListener('pause', resumeTransportPause)
    }
  }, [allowsAutomaticPlay, mediaStream, status.live, videoElement])

  useEffect(() => {
    const video = videoElement
    if (!video) return

    let active = true
    let reader: MediaMtxReader | undefined
    let readerToRetire: MediaMtxReader | undefined
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined
    let repairTimer: ReturnType<typeof setTimeout> | undefined
    let audioTimer: ReturnType<typeof setTimeout> | undefined
    let watchdogTimer: ReturnType<typeof setInterval> | undefined
    let readerGeneration = 0
    let peerConnectionForWatchdog: RTCPeerConnection | undefined
    let expectedVideoTrack = false
    let watchdogPlaying = false
    let watchdogPollInFlight = false
    let presentedFrameCount = 0
    let presentationCallbackHandle: number | undefined
    let presentationCallbackGeneration = 0
    let recoveryCount = 0
    let recoveryInProgress = false
    let fallbackTriggered = false

    queueMicrotask(() => {
      if (active) setPeerConnection(null)
    })

    const clearMedia = () => {
      video.pause()
    }

    const resetProgress = () => {
      presentedFrameCount = 0
      progress.reset()
    }

    const stopPresentationFrames = () => {
      const frameVideo = video as VideoFrameCallbackElement
      if (
        presentationCallbackHandle !== undefined &&
        typeof frameVideo.cancelVideoFrameCallback === 'function'
      ) {
        frameVideo.cancelVideoFrameCallback(presentationCallbackHandle)
      }
      presentationCallbackHandle = undefined
    }

    const schedulePresentationFrame = (generation: number) => {
      const frameVideo = video as VideoFrameCallbackElement
      if (
        !active ||
        !watchdogPlaying ||
        generation !== readerGeneration ||
        !frameVideo.requestVideoFrameCallback
      ) {
        return
      }

      presentationCallbackGeneration = generation
      presentationCallbackHandle = frameVideo.requestVideoFrameCallback(() => {
        presentationCallbackHandle = undefined
        if (
          !active ||
          !watchdogPlaying ||
          presentationCallbackGeneration !== readerGeneration
        ) {
          return
        }
        presentedFrameCount += 1
        schedulePresentationFrame(generation)
      })
    }

    const stopWatchdog = () => {
      watchdogPlaying = false
      if (watchdogTimer !== undefined) {
        clearInterval(watchdogTimer)
        watchdogTimer = undefined
      }
      stopPresentationFrames()
      resetProgress()
    }

    const readInboundVideoFrames = async (
      connection: RTCPeerConnection | undefined,
    ): Promise<number | undefined> => {
      if (!connection) return undefined

      try {
        const report = await connection.getStats()
        let framesDecoded: number | undefined
        report.forEach((entry) => {
          const stat = entry as unknown as Record<string, unknown>
          if (
            stat.type === 'inbound-rtp' &&
            (stat.kind === 'video' || stat.mediaType === 'video') &&
            typeof stat.framesDecoded === 'number'
          ) {
            framesDecoded = stat.framesDecoded
          }
        })
        return framesDecoded
      } catch {
        return undefined
      }
    }

    const pollVideoProgress = async () => {
      if (
        !active ||
        !watchdogPlaying ||
        watchdogPollInFlight ||
        !canRecover() ||
        video.paused ||
        video.ended ||
        !expectedVideoTrack
      ) {
        if (!canRecover() || video.paused || video.ended) {
          resetProgress()
        }
        return
      }

      watchdogPollInFlight = true
      const generation = readerGeneration
      try {
        let frameCount = await readInboundVideoFrames(peerConnectionForWatchdog)
        if (!active || generation !== readerGeneration) return
        if (
          !canRecover() ||
          video.paused ||
          video.ended ||
          !expectedVideoTrack
        ) {
          resetProgress()
          return
        }

        if (frameCount === undefined) {
          try {
            const quality = video.getVideoPlaybackQuality?.()
            if (quality && typeof quality.totalVideoFrames === 'number') {
              frameCount = quality.totalVideoFrames
            }
          } catch {
            // Some browser implementations expose this method but throw.
          }
        }

        if (frameCount === undefined) {
          const frameVideo = video as VideoFrameCallbackElement
          if (typeof frameVideo.requestVideoFrameCallback !== 'function') {
            resetProgress()
            return
          }
          frameCount = presentedFrameCount
        }

        const observation = progress.observe(frameCount)
        if (observation.stable) recoveryCount = 0

        if (!observation.stalled || recoveryInProgress || fallbackTriggered) return

        recoveryInProgress = true

        if (recoveryCount === 0) {
          recoveryCount = 1
          readerGeneration += 1
          const oldReader = reader
          reader = undefined
          readerToRetire = oldReader
          peerConnectionForWatchdog = undefined
          expectedVideoTrack = false
          stopWatchdog()
          setPeerConnection(null)
          setPlaybackPhase('reconnecting')
          if (ReaderConstructor) createReader(ReaderConstructor)
        } else {
          recoveryCount = 2
          fallbackTriggered = true
          stopWatchdog()
          reader?.close()
          reader = undefined
          readerToRetire?.close()
          readerToRetire = undefined
          clearTimeout(fallbackTimer)
          clearMedia()
          fallbackRef.current()
        }
      } finally {
        watchdogPollInFlight = false
      }
    }

    const startWatchdog = () => {
      stopWatchdog()
      watchdogPlaying = true
      recoveryInProgress = false
      resetProgress()
      watchdogTimer = setInterval(() => {
        void pollVideoProgress()
      }, 1_000)
      schedulePresentationFrame(readerGeneration)
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
      setPlaybackPhase('playing')
      startWatchdog()
    }

    video.addEventListener('playing', handlePlaying)
    const handleVisibilityChange = () => resetProgress()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    let ReaderConstructor: MediaMtxReaderConstructor | undefined

    const createReader = (Reader: MediaMtxReaderConstructor) => {
      if (!active) return
      const generation = readerGeneration
      reader = new Reader({
        url: new URL(channel.playback.webrtc, window.location.href).href,
        onError: () => {
          if (!active || generation !== readerGeneration) return
          setPlaybackPhase('reconnecting')
          void authClient.getSession().then(({ data }) => {
            if (!active || generation !== readerGeneration) return
            if (!data) {
              reader?.close()
              readerToRetire?.close()
              readerToRetire = undefined
              clearTimeout(fallbackTimer)
              setPlaybackPhase('unauthorized')
              return
            }
            if (recoveryCount === 0 && ReaderConstructor) {
              recoveryCount = 1
              readerGeneration += 1
              readerToRetire = reader
              reader = undefined
              peerConnectionForWatchdog = undefined
              expectedVideoTrack = false
              stopWatchdog()
              setPeerConnection(null)
              clearTimeout(repairTimer)
              repairTimer = setTimeout(() => {
                if (active && ReaderConstructor) createReader(ReaderConstructor)
              }, 1_000)
            } else {
              scheduleFallback(5_000)
            }
          })
        },
        onTrack: (event) => {
          if (!active || generation !== readerGeneration) return

          const eventTarget = event.currentTarget
          if (eventTarget && 'getStats' in eventTarget) {
            peerConnectionForWatchdog = eventTarget as RTCPeerConnection
            setPeerConnection(peerConnectionForWatchdog)
          }

          const stream = event.streams[0]
          if (!stream) return

          const videoTracks =
            typeof stream.getVideoTracks === 'function'
              ? stream.getVideoTracks()
              : []
          expectedVideoTrack =
            event.track?.kind === 'video' ||
            videoTracks.length > 0 ||
            sourceHasVideoRef.current

          setMediaStream(stream)

          if (readerToRetire) {
            const retireAfterFirstFrame = () => {
              if (!active || generation !== readerGeneration) return
              if (video.srcObject === stream) {
                readerToRetire?.close()
                readerToRetire = undefined
                return
              }

              const frameVideo = video as VideoFrameCallbackElement
              if (frameVideo.requestVideoFrameCallback) {
                frameVideo.requestVideoFrameCallback(retireAfterFirstFrame)
              } else {
                video.addEventListener('playing', retireAfterFirstFrame, {
                  once: true,
                })
              }
            }
            const frameVideo = video as VideoFrameCallbackElement
            if (frameVideo.requestVideoFrameCallback) {
              frameVideo.requestVideoFrameCallback(retireAfterFirstFrame)
            } else {
              video.addEventListener('playing', retireAfterFirstFrame, {
                once: true,
              })
            }
          }
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
      scheduleFallback(recoveryCount > 0 ? 5_000 : 8_000)
    }

    void loadReader()
      .then((Reader) => {
        if (!active) return
        ReaderConstructor = Reader
        createReader(Reader)
      })
      .catch(() => {
        if (!active) return
        setPlaybackPhase('error')
        scheduleFallback(2_000)
      })

    return () => {
      active = false
      readerGeneration += 1
      clearTimeout(fallbackTimer)
      clearTimeout(repairTimer)
      clearTimeout(audioTimer)
      video.removeEventListener('playing', handlePlaying)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopWatchdog()
      reader?.close()
      readerToRetire?.close()
      clearMedia()
    }
  }, [
    channel.playback.webrtc,
    canRecover,
    progress,
    setPlaybackPhase,
    status.live,
    videoElement,
  ])

  return (
    <div className="player-frame">
      <div
        className="player-shell"
        style={{ '--accent': channel.accentColor } as React.CSSProperties}
      >
        <VidstackPlayer
          ariaLabel={`${channel.title} live video`}
          onUserPauseChange={onUserPauseChange}
          onVideoElementChange={onVideoElementChange}
          poster={channel.poster}
          src={playerSource}
          streamType="live"
        >
          {playing && (
            <span className="protocol-badge">
              <Waves className="size-3" aria-hidden="true" />
              WebRTC · Low latency
            </span>
          )}

          <PlaybackRunOverlay
            channelSlug={channel.slug}
            loadingDescription="WebRTC is connecting. HLS will take over automatically if it cannot connect."
            loadingTitle="Starting low-latency stream"
            progressAction={(
              <Button onClick={onFallback} size="sm" variant="ghost">
                Use compatibility mode
              </Button>
            )}
            reconnectingDescription="WebRTC is reconnecting. HLS will take over automatically if it cannot recover."
            state={playbackState}
          >
            {playbackState === 'error' && (
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
            )}
          </PlaybackRunOverlay>
        </VidstackPlayer>
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
