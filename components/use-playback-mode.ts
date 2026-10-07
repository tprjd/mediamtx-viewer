'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { isWebRtcAvailable, webrtcUnavailableReason } from '@/lib/playback-availability'
import {
  hlsPlaybackContract,
  type PlaybackMode,
  ultraLowFallback,
  webRtcTransportFallback,
} from '@/lib/streaming-contract'

const MODE_STORAGE_KEY = 'mediamtx-viewer:playback-mode'
const FALLBACK_STORAGE_KEY = 'mediamtx-viewer:webrtc-fallback'
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
  const [modeExitReason, setModeExitReason] = useState<string>()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const ultraLowAvailable = supportsUltraLow()
      setUltraLowSupported(ultraLowAvailable)
      const savedFallback = window.sessionStorage.getItem(FALLBACK_STORAGE_KEY)
      if (savedFallback) {
        try {
          const value = JSON.parse(savedFallback)
          if (Number.isFinite(value.retryAfter) &&
              (value.startedAt === null || typeof value.startedAt === 'string')) {
            setFallback(value)
            if (value.active !== false) {
              setMode(webRtcFallback.mode)
              return
            }
          }
        } catch { /* Ignore invalid storage from an older browser session. */ }
      }
      const saved = window.sessionStorage.getItem(MODE_STORAGE_KEY)
      if (!saved) {
        setMode(preferredPlayback === 'webrtc' && webrtcAvailable ? 'webrtc' : 'balanced')
      }
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
          setMode('balanced')
          setModeExitReason(webrtcUnavailableReasonText)
        }
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [preferredPlayback, supportsUltraLow, webrtcAvailable, webrtcUnavailableReasonText])

  useEffect(() => {
    if (mode !== 'webrtc' || webrtcAvailable) return
    queueMicrotask(() => {
      setMode('balanced')
      setModeExitReason(webrtcUnavailableReasonText)
    })
  }, [mode, webrtcAvailable, webrtcUnavailableReasonText])

  const retryAfter =
    fallback?.startedAt === streamStartedAt ? fallback.retryAfter : 0

  useEffect(() => {
    if (retryAfter <= now) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [now, retryAfter])

  // Contract fallbacks can target a mode that is not offered as a user choice.
  const commitMode = useCallback((next: PlaybackMode) => {
    setModeExitReason(undefined)
    setMode(next)
    window.sessionStorage.setItem(MODE_STORAGE_KEY, next)
  }, [])

  const onWebRtcFallback = useCallback(() => {
    const cooldown = Date.now() + webRtcFallback.retryCooldownMs
    const next = { retryAfter: cooldown, startedAt: streamStartedAt }
    setFallback(next)
    window.sessionStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(next))
    setNow(Date.now())
    setMode(webRtcFallback.mode)
    setModeExitReason(undefined)
  }, [streamStartedAt])

  const onBalancedUnavailable = useCallback(() => {
    setBalancedUnavailable(true)
    commitMode('smooth')
  }, [commitMode])

  const onUltraLowUnavailable = useCallback((reason?: string) => {
    const unavailableReason = reason ??
      `${ultraLowContract.label} requires hls.js and is unavailable in this browser.`
    setUltraLowSupported(false)
    if (mode !== 'ultra-low') return
    commitMode(ultraLowFallback('unavailable'))
    setModeExitReason(unavailableReason)
  }, [mode, commitMode])

  const onUltraLowFailure = useCallback((reason: string) => {
    const fallbackMode = ultraLowFallback('unstable')
    commitMode(fallbackMode)
    setModeExitReason(
      `${reason} Switched to ${hlsPlaybackContract(fallbackMode).label}.`,
    )
  }, [commitMode])

  const webRtcSelectable = webrtcAvailable && live && retryAfter <= now
  const selectableModes = useMemo<readonly PlaybackMode[]>(() => {
    const choices: PlaybackMode[] = []
    if (ultraLowSupported) choices.push('ultra-low')
    if (!balancedUnavailable) choices.push('balanced')
    choices.push('smooth')
    if (webRtcSelectable) choices.push('webrtc')
    return choices
  }, [balancedUnavailable, ultraLowSupported, webRtcSelectable])

  const selectMode = useCallback((value: string) => {
    const selected = selectableModes.find(choice => choice === value)
    if (selected) {
      if (fallback) {
        window.sessionStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify({ ...fallback, active: false }))
      }
      commitMode(selected)
    }
  }, [commitMode, fallback, selectableModes])

  return {
    mode,
    modeExitReason,
    onBalancedUnavailable,
    onUltraLowFailure,
    onUltraLowUnavailable,
    onWebRtcFallback,
    selectableModes,
    selectMode,
  }
}
