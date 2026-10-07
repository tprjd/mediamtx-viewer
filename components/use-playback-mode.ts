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

  // Contract fallbacks can target a mode that is not offered as a user choice.
  const commitMode = useCallback((next: PlaybackMode) => {
    setModeExitReason(undefined)
    setMode(next)
    window.sessionStorage.setItem(MODE_STORAGE_KEY, next)
  }, [])

  const onWebRtcFallback = useCallback(() => {
    const cooldown = Date.now() + webRtcFallback.retryCooldownMs
    setFallback({ retryAfter: cooldown, startedAt: streamStartedAt })
    setNow(Date.now())
    commitMode(webRtcFallback.mode)
  }, [commitMode, streamStartedAt])

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
    if (selected) commitMode(selected)
  }, [commitMode, selectableModes])

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
