'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  PlaybackRun,
  PlaybackProgressMonitor,
  type PlaybackRunPhase,
  visiblePlaybackState,
} from '@/lib/playback-run'
import { checkViewingAccess } from '@/lib/auth/viewing-access-client'

export function usePlaybackRun(live: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const userPausedRef = useRef(false)
  const progressMonitorRef = useRef(new PlaybackProgressMonitor())
  const runRef = useRef<PlaybackRun | null>(null)
  const [phase, setPhase] = useState<PlaybackRunPhase>('loading')
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)

  const onVideoElementChange = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video
    setVideoElement(video)
  }, [])

  const onUserPauseChange = useCallback((paused: boolean) => {
    userPausedRef.current = paused
    if (paused) progressMonitorRef.current.reset()
    runRef.current?.environmentChanged()
  }, [])

  const environment = useCallback(
    () => ({
      live,
      online: typeof navigator === 'undefined' || navigator.onLine !== false,
      userPaused: userPausedRef.current,
      visible:
        typeof document === 'undefined' || document.visibilityState === 'visible',
    }),
    [live],
  )
  const startRun = useCallback((actions: { stop: () => void; resume?: () => void }) => {
    runRef.current?.dispose()
    const run = new PlaybackRun({
      ...actions,
      environment,
      onPhaseChange: setPhase,
      checkSession: checkViewingAccess,
      progress: progressMonitorRef.current,
    })
    runRef.current = run
    run.report('loading')
    return run
  }, [environment])

  const report = useCallback((phase: PlaybackRunPhase) => {
    if (runRef.current) return runRef.current.report(phase)
    setPhase(phase)
    return true
  }, [])
  const allowsAutomaticPlay = useCallback(
    () => runRef.current?.allowsAutomaticPlay() ?? (live && !userPausedRef.current),
    [live],
  )

  useEffect(() => {
    const environmentChanged = () => runRef.current?.environmentChanged()
    window.addEventListener('online', environmentChanged)
    window.addEventListener('offline', environmentChanged)
    document.addEventListener('visibilitychange', environmentChanged)
    return () => {
      window.removeEventListener('online', environmentChanged)
      window.removeEventListener('offline', environmentChanged)
      document.removeEventListener('visibilitychange', environmentChanged)
      runRef.current?.dispose()
    }
  }, [])

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
    onUserPauseChange,
    onVideoElementChange,
    playing: state === 'playing',
    progress,
    report,
    startRun,
    state,
    videoElement,
    videoRef,
  }
}
