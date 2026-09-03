'use client'

import { useCallback, useMemo, useRef, useState } from 'react'

import {
  playbackCanRecover,
  PlaybackProgressMonitor,
  type PlaybackRunPhase,
  visiblePlaybackState,
} from '@/lib/playback-run'

export function usePlaybackRun(live: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const userPausedRef = useRef(false)
  const progressMonitorRef = useRef(new PlaybackProgressMonitor())
  const [phase, setPhase] = useState<PlaybackRunPhase>('loading')
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)

  const onVideoElementChange = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video
    setVideoElement(video)
  }, [])

  const onUserPauseChange = useCallback((paused: boolean) => {
    userPausedRef.current = paused
    if (paused) progressMonitorRef.current.reset()
  }, [])

  const canRecover = useCallback(
    () =>
      playbackCanRecover({
        live,
        online: typeof navigator === 'undefined' || navigator.onLine !== false,
        userPaused: userPausedRef.current,
        visible:
          typeof document === 'undefined' || document.visibilityState === 'visible',
      }),
    [live],
  )
  const allowsAutomaticPlay = useCallback(() => !userPausedRef.current, [])

  const progress = useMemo(
    () => ({
      observe(value: number | undefined, now = Date.now()) {
        return progressMonitorRef.current.observe(value, now)
      },
      reset() {
        progressMonitorRef.current.reset()
      },
    }),
    [],
  )

  const state = visiblePlaybackState(live, phase)
  return {
    allowsAutomaticPlay,
    canRecover,
    onUserPauseChange,
    onVideoElementChange,
    playing: state === 'playing',
    progress,
    setPhase,
    state,
    videoElement,
    videoRef,
  }
}
