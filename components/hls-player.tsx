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
import {
  PlaybackStats,
  type HlsPlaybackDiagnostics,
} from '@/components/playback-stats'
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
  latencyProfile: HlsLatencyProfile
  onBalancedUnavailable?: () => void
  onUltraLowFailure?: (reason: string) => void
  onUltraLowUnavailable?: (reason?: string) => void
  profileExitReason?: string
}

export type HlsLatencyProfile = 'ultra-low' | 'balanced' | 'smooth'

interface HlsLatencyProfileConfig {
  backBufferLength: number
  forwardBufferLimit?: number
  label: string
  liveMaxLatencyDuration: number
  liveSyncDuration: number
  liveSyncOnStallIncrease: number
  maxBufferLength?: number
  maxLiveSyncPlaybackRate: number
  maxMaxBufferLength?: number
}

export const HLS_LATENCY_PROFILES = {
  'ultra-low': {
    backBufferLength: 0,
    forwardBufferLimit: 2,
    label: 'HLS ≤2s',
    liveMaxLatencyDuration: 2,
    liveSyncDuration: 1.2,
    liveSyncOnStallIncrease: 0,
    maxBufferLength: 1.8,
    maxLiveSyncPlaybackRate: 1.05,
    maxMaxBufferLength: 1.8,
  },
  balanced: {
    backBufferLength: 30,
    label: 'Balanced',
    liveMaxLatencyDuration: 6,
    liveSyncDuration: 3,
    liveSyncOnStallIncrease: 0.5,
    maxLiveSyncPlaybackRate: 1.03,
  },
  smooth: {
    backBufferLength: 30,
    label: 'Smooth',
    liveMaxLatencyDuration: 9,
    liveSyncDuration: 5,
    liveSyncOnStallIncrease: 1,
    maxLiveSyncPlaybackRate: 1.02,
  },
} as const satisfies Record<HlsLatencyProfile, HlsLatencyProfileConfig>

const ULTRA_LOW_SAMPLE_INTERVAL_MS = 250
const ULTRA_LOW_CORRECTION_COOLDOWN_MS = 1_000
const ULTRA_LOW_FAILURE_WINDOW_MS = 30_000

interface HlsSloState {
  correctiveSeekCount: number
  forwardBufferBreaching: boolean
  forwardBufferBreachCount: number
  lastBreachAt?: string
  lastBreachMetric?: 'forwardBuffer' | 'liveLatency'
  lastBreachValueSeconds?: number
  latencyBreaching: boolean
  latencyBreachCount: number
  latencyCorrectionAt?: number
  latencyRecoveryScheduled: boolean
  maxObservedForwardBufferSeconds?: number
  maxObservedLatencySeconds?: number
}

function createHlsSloState(): HlsSloState {
  return {
    correctiveSeekCount: 0,
    forwardBufferBreaching: false,
    forwardBufferBreachCount: 0,
    latencyBreaching: false,
    latencyBreachCount: 0,
    latencyRecoveryScheduled: false,
  }
}

export function isHlsJsSupported(): boolean {
  return Hls.isSupported()
}

function isCodecError(details: ErrorDetails): boolean {
  return details.toLowerCase().includes('codec')
}

function readForwardBuffer(video: HTMLVideoElement): number | undefined {
  try {
    for (let index = 0; index < video.buffered.length; index += 1) {
      const start = video.buffered.start(index)
      const end = video.buffered.end(index)
      if (video.currentTime >= start - 0.05 && video.currentTime <= end) {
        return Math.max(0, end - video.currentTime)
      }
    }
  } catch {
    // TimeRanges can change between reading its length and range boundaries.
  }
  return undefined
}

function readNativeLiveEdge(video: HTMLVideoElement): number | undefined {
  try {
    if (video.seekable.length === 0) return undefined
    return video.seekable.end(video.seekable.length - 1)
  } catch {
    return undefined
  }
}

function readNativeSeekTarget(
  video: HTMLVideoElement,
  liveEdge: number,
  targetLatency: number,
): number | undefined {
  try {
    if (video.seekable.length === 0) return undefined
    return Math.max(
      video.seekable.start(video.seekable.length - 1),
      liveEdge - targetLatency,
    )
  } catch {
    return undefined
  }
}

export function HlsPlayer({
  channel,
  latencyProfile,
  onBalancedUnavailable,
  onUltraLowFailure,
  onUltraLowUnavailable,
  profileExitReason,
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const recoveryRef = useRef({ attempts: 0 })
  const lastCorrectionRef = useRef<string>(undefined)
  const sloRef = useRef<HlsSloState>(createHlsSloState())
  const ultraLowInstabilityRef = useRef<number[]>([])
  const ultraLowLastInstabilityRef = useRef<number>(undefined)
  const profile: HlsLatencyProfileConfig = HLS_LATENCY_PROFILES[latencyProfile]
  const [playbackState, setPlaybackState] = useState<Exclude<PlaybackState, 'offline'>>(
    'loading',
  )
  const [reloadKey, setReloadKey] = useState(0)
  const [usingFallback, setUsingFallback] = useState(false)
  const [hlsDiagnostics, setHlsDiagnostics] = useState<HlsPlaybackDiagnostics>({
    maxLatencySeconds: profile.liveMaxLatencyDuration,
    playbackRate: 1,
    profileExitReason,
    targetLatencySeconds: profile.liveSyncDuration,
  })
  const status = channel.status
  const sourceUrl =
    usingFallback && channel.playback.fallbackHls
      ? channel.playback.fallbackHls
      : channel.playback.hls

  useEffect(() => {
    if (latencyProfile !== 'ultra-low') return
    sloRef.current = createHlsSloState()
    ultraLowInstabilityRef.current = []
    ultraLowLastInstabilityRef.current = undefined
  }, [latencyProfile])

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
    let nativeHls = false
    let excessiveNativeLatencySamples = 0
    let missingNativeLiveEdgeSamples = 0
    let reportedBalancedUnavailable = false
    let reportedUltraLowPackagingUnsupported = false
    let lastMeasuredLatency: number | undefined
    const slo = sloRef.current

    slo.forwardBufferBreaching = false
    slo.latencyBreaching = false
    slo.latencyCorrectionAt = undefined
    slo.latencyRecoveryScheduled = false

    setHlsDiagnostics({
      configuredMaxForwardBufferSeconds: profile.forwardBufferLimit,
      correctiveSeekCount: slo.correctiveSeekCount,
      forwardBufferBreachCount: slo.forwardBufferBreachCount,
      forwardBufferLoadLimitSeconds: profile.maxMaxBufferLength,
      lastBreachAt: slo.lastBreachAt,
      lastBreachMetric: slo.lastBreachMetric,
      lastBreachValueSeconds: slo.lastBreachValueSeconds,
      latencyBreachCount: slo.latencyBreachCount,
      maxLatencySeconds: profile.liveMaxLatencyDuration,
      maxObservedForwardBufferSeconds: slo.maxObservedForwardBufferSeconds,
      maxObservedLatencySeconds: slo.maxObservedLatencySeconds,
      lastCorrection: lastCorrectionRef.current,
      playbackRate: video.playbackRate,
      profileExitReason,
      targetLatencySeconds: profile.liveSyncDuration,
    })

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

    const markCorrection = (reason: string, correctiveSeek = false) => {
      lastCorrectionRef.current = reason
      if (correctiveSeek && latencyProfile === 'ultra-low') {
        slo.correctiveSeekCount += 1
      }
    }

    const publishDiagnostics = () => {
      if (!active) return
      const details = hls?.latestLevelDetails
      const nativeLiveEdge = nativeHls ? readNativeLiveEdge(video) : undefined
      const measuredLatency = hls
        ? hls.latency > 0
          ? hls.latency
          : undefined
        : nativeLiveEdge === undefined
          ? undefined
          : Math.max(0, nativeLiveEdge - video.currentTime)
      const playingDate = hls?.playingDate
      const playingDateLatency = playingDate
        ? Math.max(0, (Date.now() - playingDate.getTime()) / 1_000)
        : undefined

      lastMeasuredLatency = measuredLatency
      setHlsDiagnostics({
        bufferAheadSeconds: readForwardBuffer(video),
        configuredMaxForwardBufferSeconds: profile.forwardBufferLimit,
        correctiveSeekCount: slo.correctiveSeekCount,
        engine: nativeHls ? 'native HLS' : hls ? 'hls.js' : undefined,
        forwardBufferBreachCount: slo.forwardBufferBreachCount,
        forwardBufferLoadLimitSeconds: profile.maxMaxBufferLength,
        lastCorrection: lastCorrectionRef.current,
        lastBreachAt: slo.lastBreachAt,
        lastBreachMetric: slo.lastBreachMetric,
        lastBreachValueSeconds: slo.lastBreachValueSeconds,
        latencyBreachCount: slo.latencyBreachCount,
        liveLatencySeconds: measuredLatency,
        maxLatencySeconds: profile.liveMaxLatencyDuration,
        maxObservedForwardBufferSeconds: slo.maxObservedForwardBufferSeconds,
        maxObservedLatencySeconds: slo.maxObservedLatencySeconds,
        partHoldBackSeconds: details?.partHoldBack || undefined,
        partTargetSeconds: details?.partTarget || undefined,
        playbackRate: video.playbackRate,
        playingDateLatencySeconds: playingDateLatency,
        profileExitReason,
        targetDurationSeconds: details?.targetduration || undefined,
        targetLatencySeconds: profile.liveSyncDuration,
      })
    }

    const reportUltraLowInstability = (reason: string): boolean => {
      if (latencyProfile !== 'ultra-low') return false
      const now = Date.now()
      if (
        ultraLowLastInstabilityRef.current !== undefined &&
        now - ultraLowLastInstabilityRef.current < ULTRA_LOW_CORRECTION_COOLDOWN_MS
      ) {
        return false
      }

      ultraLowLastInstabilityRef.current = now
      const recent = ultraLowInstabilityRef.current.filter(
        (timestamp) => now - timestamp <= ULTRA_LOW_FAILURE_WINDOW_MS,
      )
      recent.push(now)
      ultraLowInstabilityRef.current = recent
      if (recent.length < 2 || !onUltraLowFailure) return false

      ultraLowInstabilityRef.current = []
      onUltraLowFailure(
        `HLS ≤2s could not be maintained after repeated ${reason}. Switched to Balanced.`,
      )
      return true
    }

    const scheduleRecreate = (
      immediate = false,
      instabilityReason = 'playback recoveries',
    ) => {
      needsRecovery = true
      setPlaybackState('reconnecting')
      clearTimeout(retryTimer)
      if (!canRecover()) return
      if (reportUltraLowInstability(instabilityReason)) return

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
      publishDiagnostics()

      if (
        nativeHls &&
        canRecover() &&
        !video.paused &&
        !video.ended &&
        !video.seeking &&
        video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      ) {
        const liveEdge = readNativeLiveEdge(video)
        const latency = liveEdge === undefined
          ? undefined
          : Math.max(0, liveEdge - video.currentTime)
        const bufferAhead = readForwardBuffer(video)
        const catchUpDistance = latency === undefined
          ? Number.POSITIVE_INFINITY
          : Math.max(1, latency - profile.liveSyncDuration)

        if (latencyProfile === 'balanced' && liveEdge === undefined) {
          missingNativeLiveEdgeSamples += 1
          if (
            missingNativeLiveEdgeSamples >= 5 &&
            !reportedBalancedUnavailable
          ) {
            reportedBalancedUnavailable = true
            onBalancedUnavailable?.()
          }
        } else {
          missingNativeLiveEdgeSamples = 0
        }

        if (
          latency !== undefined &&
          latency > profile.liveMaxLatencyDuration &&
          bufferAhead !== undefined &&
          bufferAhead >= catchUpDistance
        ) {
          excessiveNativeLatencySamples += 1
        } else {
          excessiveNativeLatencySamples = 0
        }

        if (excessiveNativeLatencySamples > 2 && liveEdge !== undefined) {
          const seekTarget = readNativeSeekTarget(
            video,
            liveEdge,
            profile.liveSyncDuration,
          )
          if (seekTarget !== undefined) {
            video.currentTime = seekTarget
            markCorrection(
              `Native latency exceeded ${profile.liveMaxLatencyDuration}s`,
              true,
            )
          }
          excessiveNativeLatencySamples = 0
          publishDiagnostics()
        }
      } else {
        excessiveNativeLatencySamples = 0
        missingNativeLiveEdgeSamples = 0
      }

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
          markCorrection('Frozen playback recovery', true)
          publishDiagnostics()
        }
        hls.startLoad()
        return
      }

      scheduleRecreate(false, 'playback stalls')
    }

    const clearUltraLowBreachWindow = () => {
      slo.forwardBufferBreaching = false
      slo.latencyBreaching = false
      slo.latencyCorrectionAt = undefined
      slo.latencyRecoveryScheduled = false
    }

    const recordBreach = (
      metric: 'forwardBuffer' | 'liveLatency',
      value: number,
    ) => {
      const isLatency = metric === 'liveLatency'
      const alreadyBreaching = isLatency
        ? slo.latencyBreaching
        : slo.forwardBufferBreaching
      if (alreadyBreaching) return

      if (isLatency) {
        slo.latencyBreaching = true
        slo.latencyBreachCount += 1
      } else {
        slo.forwardBufferBreaching = true
        slo.forwardBufferBreachCount += 1
      }
      slo.lastBreachAt = new Date().toISOString()
      slo.lastBreachMetric = metric
      slo.lastBreachValueSeconds = value
    }

    const pollUltraLowSlo = () => {
      if (
        latencyProfile !== 'ultra-low' ||
        !hls ||
        !everPlayed ||
        !canRecover() ||
        video.paused ||
        video.ended ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        clearUltraLowBreachWindow()
        return
      }
      if (video.seeking) return

      const latency = hls.latency > 0 ? hls.latency : undefined
      const forwardBuffer = readForwardBuffer(video)
      if (latency !== undefined) {
        slo.maxObservedLatencySeconds = Math.max(
          slo.maxObservedLatencySeconds ?? 0,
          latency,
        )
      }
      if (forwardBuffer !== undefined) {
        slo.maxObservedForwardBufferSeconds = Math.max(
          slo.maxObservedForwardBufferSeconds ?? 0,
          forwardBuffer,
        )
      }

      const forwardBufferLimit = profile.forwardBufferLimit
      if (
        forwardBuffer !== undefined &&
        forwardBufferLimit !== undefined &&
        forwardBuffer > forwardBufferLimit
      ) {
        recordBreach('forwardBuffer', forwardBuffer)
      } else {
        slo.forwardBufferBreaching = false
      }

      if (latency === undefined || latency <= profile.liveMaxLatencyDuration) {
        slo.latencyBreaching = false
        slo.latencyCorrectionAt = undefined
        slo.latencyRecoveryScheduled = false
        return
      }

      recordBreach('liveLatency', latency)
      const now = Date.now()
      if (slo.latencyCorrectionAt === undefined) {
        slo.latencyCorrectionAt = now
        const syncPosition = hls.liveSyncPosition
        if (syncPosition !== null && syncPosition > video.currentTime) {
          video.currentTime = syncPosition
          markCorrection(
            `HLS ≤2s latency exceeded ${profile.liveMaxLatencyDuration}s`,
            true,
          )
        }
        return
      }

      if (
        now - slo.latencyCorrectionAt >= ULTRA_LOW_CORRECTION_COOLDOWN_MS &&
        !slo.latencyRecoveryScheduled
      ) {
        slo.latencyRecoveryScheduled = true
        scheduleRecreate(true, 'latency recoveries')
      }
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
        if (everPlayed && reportUltraLowInstability('playback stalls')) return
        needsRecovery = true
        setPlaybackState('reconnecting')
      }
    }
    const handlePause = () => {
      stagnantSamples = 0
      lastProgress = undefined
    }
    const handleSeeking = () => {
      if (
        hls &&
        lastMeasuredLatency !== undefined &&
        lastMeasuredLatency > profile.liveMaxLatencyDuration
      ) {
        markCorrection(
          `hls.js latency exceeded ${profile.liveMaxLatencyDuration}s`,
        )
        publishDiagnostics()
      }
    }
    const handleVideoError = () => {
      void authClient.getSession().then(({ data }) => {
        if (!active) return
        if (!data) {
          clearTimeout(retryTimer)
          setPlaybackState('unauthorized')
        } else if (video.error?.code !== MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          scheduleRecreate(false, 'media recoveries')
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
      if (hls && hls.latency > profile.liveMaxLatencyDuration) {
        const syncPosition = hls.liveSyncPosition
        if (syncPosition !== null) {
          video.currentTime = syncPosition
          markCorrection('Resume beyond hls.js latency limit', true)
          publishDiagnostics()
        }
      }
    }

    video.addEventListener('loadstart', handleLoadStart)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('stalled', handleWaiting)
    video.addEventListener('pause', handlePause)
    video.addEventListener('error', handleVideoError)
    video.addEventListener('play', handlePlay)
    video.addEventListener('seeking', handleSeeking)

    const resumeRecovery = () => {
      stagnantSamples = 0
      lastProgress = undefined
      if (needsRecovery && canRecover()) scheduleRecreate(true)
    }
    window.addEventListener('online', resumeRecovery)
    document.addEventListener('visibilitychange', resumeRecovery)
    const progressTimer = setInterval(pollProgress, 1_000)
    const sloTimer = latencyProfile === 'ultra-low'
      ? setInterval(pollUltraLowSlo, ULTRA_LOW_SAMPLE_INTERVAL_MS)
      : undefined

    const beginPlayback = () => {
      void video.play().catch(() => {
        // Native controls remain available when autoplay policy blocks playback.
      })
    }

    const nativeHlsSupported = Boolean(
      video.canPlayType('application/vnd.apple.mpegurl'),
    )
    const hlsJsSupported = Hls.isSupported()
    const useNativeHls =
      nativeHlsSupported &&
      !hlsJsSupported &&
      latencyProfile !== 'ultra-low'

    if (latencyProfile === 'ultra-low' && !hlsJsSupported) {
      unsupportedTimer = setTimeout(() => {
        setPlaybackState('unsupported')
        onUltraLowUnavailable?.()
      }, 0)
    } else if (useNativeHls) {
      nativeHls = true
      video.src = sourceUrl
      video.load()
      publishDiagnostics()
      beginPlayback()
    } else if (hlsJsSupported) {
      hls = new Hls({
        lowLatencyMode: true,
        liveSyncMode: 'edge',
        backBufferLength: profile.backBufferLength,
        liveSyncDuration: profile.liveSyncDuration,
        liveMaxLatencyDuration: profile.liveMaxLatencyDuration,
        ...(profile.maxBufferLength === undefined
          ? {}
          : { maxBufferLength: profile.maxBufferLength }),
        ...(profile.maxMaxBufferLength === undefined
          ? {}
          : { maxMaxBufferLength: profile.maxMaxBufferLength }),
        maxLiveSyncPlaybackRate: profile.maxLiveSyncPlaybackRate,
        liveSyncOnStallIncrease: profile.liveSyncOnStallIncrease,
      })

      hls.on(Hls.Events.MANIFEST_PARSED, beginPlayback)
      hls.on(Hls.Events.LEVEL_UPDATED, (_event, data) => {
        if (
          latencyProfile !== 'ultra-low' ||
          reportedUltraLowPackagingUnsupported
        ) {
          return
        }
        const { partTarget, targetduration } = data.details
        if (targetduration <= 1 && partTarget > 0 && partTarget <= 0.25) return

        reportedUltraLowPackagingUnsupported = true
        onUltraLowUnavailable?.(
          'HLS ≤2s requires one-second LL-HLS segments and parts no longer than 250ms.',
        )
      })
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
      publishDiagnostics()
    } else if (nativeHlsSupported) {
      nativeHls = true
      video.src = sourceUrl
      video.load()
      publishDiagnostics()
      beginPlayback()
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
      video.removeEventListener('seeking', handleSeeking)
      window.removeEventListener('online', resumeRecovery)
      document.removeEventListener('visibilitychange', resumeRecovery)
      hls?.destroy()
      clearTimeout(unsupportedTimer)
      clearTimeout(codecErrorTimer)
      clearTimeout(retryTimer)
      clearTimeout(stableTimer)
      clearInterval(progressTimer)
      if (sloTimer !== undefined) clearInterval(sloTimer)
      resetVideo()
    }
  }, [
    latencyProfile,
    onBalancedUnavailable,
    onUltraLowFailure,
    onUltraLowUnavailable,
    profile,
    profileExitReason,
    reloadKey,
    sourceUrl,
    status.live,
  ])

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
            HLS · {profile.label}
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
                  ? `Preparing ${profile.label.toLowerCase()} playback…`
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
        hlsDiagnostics={hlsDiagnostics}
        playing={visibleState === 'playing'}
        protocol="HLS"
        tracks={status.tracks}
        videoRef={videoRef}
      />
    </div>
  )
}
