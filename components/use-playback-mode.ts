'use client'

import { useCallback, useEffect, useState } from 'react'

import { isWebRtcAvailable, webrtcUnavailableReason } from '@/lib/playback-availability'
import {
  hlsPlaybackContract,
  type PlaybackMode,
  ultraLowFallback,
  webRtcTransportFallback,
} from '@/lib/streaming-contract'

const MODE_STORAGE_KEY = 'mediamtx-viewer:playback-mode'
const ultraLowContract = hlsPlaybackContract('ultra-low')
const webRtcFallback = webRtcTransportFallback()

interface PlaybackModeOptions {
  live: boolean
  preferredPlayback: 'hls' | 'webrtc'
  streamStartedAt: string | null
  supportsUltraLow: () => boolean
  tracks: readonly string[]
}

export function usePlaybackMode({
  live,
  preferredPlayback,
  streamStartedAt,
  supportsUltraLow,
  tracks,
}: PlaybackModeOptions) {
  const webrtcAvailable = isWebRtcAvailable(tracks)
  const webrtcUnavailableReasonText = webrtcUnavailableReason(tracks)
  const [mode, setMode] = useState<PlaybackMode>(
    preferredPlayback === 'webrtc' && webrtcAvailable ? 'webrtc' : 'balanced',
  )
  const [fallback, setFallback] = useState<{
    retryAfter: number
    startedAt: string | null
  } | null>(null)
  const [balancedUnavailable, setBalancedUnavailable] = useState(false)
  const [ultraLowSupported, setUltraLowSupported] = useState(false)
  const [ultraLowUnavailableReason, setUltraLowUnavailableReason] =
    useState<string>()
  const [modeExitReason, setModeExitReason] = useState<string>()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const ultraLowAvailable = supportsUltraLow()
      setUltraLowSupported(ultraLowAvailable)
      setUltraLowUnavailableReason(
        ultraLowAvailable
          ? undefined
          : `${ultraLowContract.label} requires hls.js and Media Source Extensions.`,
      )
      const saved = window.sessionStorage.getItem(MODE_STORAGE_KEY)
      if (saved === 'hls') {
        window.sessionStorage.setItem(MODE_STORAGE_KEY, 'balanced')
        setMode('balanced')
      }
      if (saved === 'ultra-low') {
        if (ultraLowAvailable) {
          setMode('ultra-low')
        } else {
          window.sessionStorage.setItem(MODE_STORAGE_KEY, 'balanced')
          setMode('balanced')
          setModeExitReason(
            `${ultraLowContract.label} requires hls.js and is unavailable in this browser.`,
          )
        }
      }
      if (saved === 'balanced' || saved === 'smooth') {
        setMode(saved)
      }
      if (saved === 'webrtc') {
        if (webrtcAvailable) {
          setMode('webrtc')
        } else {
          window.sessionStorage.setItem(MODE_STORAGE_KEY, 'balanced')
          setMode('balanced')
          setModeExitReason(webrtcUnavailableReasonText)
        }
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [supportsUltraLow, webrtcAvailable, webrtcUnavailableReasonText])

  useEffect(() => {
    if (mode !== 'webrtc' || webrtcAvailable) return
    queueMicrotask(() => {
      setMode('balanced')
      setModeExitReason(webrtcUnavailableReasonText)
    })
  }, [mode, webrtcAvailable, webrtcUnavailableReasonText])

  // Initial preferredPlayback fallback: remember the graceful degradation so a
  // later pageload does not blindly retry WebRTC.
  useEffect(() => {
    if (preferredPlayback !== 'webrtc' || webrtcAvailable) return
    if (window.sessionStorage.getItem(MODE_STORAGE_KEY) !== null) return
    window.sessionStorage.setItem(MODE_STORAGE_KEY, 'balanced')
    queueMicrotask(() => setModeExitReason(webrtcUnavailableReasonText))
  }, [preferredPlayback, webrtcAvailable, webrtcUnavailableReasonText])

  const retryAfter =
    fallback?.startedAt === streamStartedAt ? fallback.retryAfter : 0

  useEffect(() => {
    if (retryAfter <= now) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [now, retryAfter])

  const selectMode = useCallback((next: PlaybackMode) => {
    setModeExitReason(undefined)
    setMode(next)
    window.sessionStorage.setItem(MODE_STORAGE_KEY, next)
  }, [])

  const onWebRtcFallback = useCallback(() => {
    const cooldown = Date.now() + webRtcFallback.retryCooldownMs
    setFallback({ retryAfter: cooldown, startedAt: streamStartedAt })
    setNow(Date.now())
    selectMode(webRtcFallback.mode)
  }, [selectMode, streamStartedAt])

  const onBalancedUnavailable = useCallback(() => {
    setBalancedUnavailable(true)
    selectMode('smooth')
  }, [selectMode])

  const onUltraLowUnavailable = useCallback((reason?: string) => {
    const unavailableReason = reason ??
      `${ultraLowContract.label} requires hls.js and is unavailable in this browser.`
    setUltraLowSupported(false)
    setUltraLowUnavailableReason(unavailableReason)
    if (mode !== 'ultra-low') return
    selectMode(ultraLowFallback('unavailable'))
    setModeExitReason(unavailableReason)
  }, [mode, selectMode])

  const onUltraLowFailure = useCallback((reason: string) => {
    const fallbackMode = ultraLowFallback('unstable')
    selectMode(fallbackMode)
    setModeExitReason(
      `${reason} Switched to ${hlsPlaybackContract(fallbackMode).label}.`,
    )
  }, [selectMode])

  const retrySeconds = Math.max(0, Math.ceil((retryAfter - now) / 1_000))
  return {
    balancedUnavailable,
    lowLatencyDisabled: !live || retrySeconds > 0,
    webrtcAvailable,
    webrtcUnavailableReason: webrtcUnavailableReasonText,
    mode,
    modeExitReason,
    onBalancedUnavailable,
    onUltraLowFailure,
    onUltraLowUnavailable,
    onWebRtcFallback,
    retrySeconds,
    selectMode,
    ultraLowSupported,
    ultraLowUnavailableReason,
  }
}
