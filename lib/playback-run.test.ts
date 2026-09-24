import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  playbackCanRecover,
  PlaybackProgressMonitor,
  PlaybackRun,
  visiblePlaybackState,
} from '@/lib/playback-run'
import type { PlaybackSessionResult } from '@/lib/playback-session'

describe('PlaybackRun coordination', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup() {
    const environment = { live: true, online: true, visible: true, userPaused: false }
    const stop = vi.fn()
    const resume = vi.fn()
    const onPhaseChange = vi.fn()
    const checkSession = vi.fn<(signal: AbortSignal) => Promise<PlaybackSessionResult>>()
      .mockResolvedValue('authorized')
    const run = new PlaybackRun({
      environment: () => environment,
      stop,
      resume,
      onPhaseChange,
      checkSession,
      progress: new PlaybackProgressMonitor(),
    })
    return { run, environment, stop, resume, onPhaseChange, checkSession }
  }

  it('cancels delayed recovery when playback resumes', async () => {
    const { run } = setup()
    const repair = vi.fn()
    run.recover(repair, 1_000)
    run.report('playing')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(repair).not.toHaveBeenCalled()
  })

  it.each(['visible', 'online', 'userPaused'] as const)('defers recovery while %s blocks it and resumes only once', async (key) => {
    const { run, environment } = setup()
    const repair = vi.fn()
    run.recover(repair, 1_000)
    environment[key] = key === 'userPaused'
    run.environmentChanged()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(repair).not.toHaveBeenCalled()
    environment[key] = key !== 'userPaused'
    run.environmentChanged()
    run.environmentChanged()
    await vi.advanceTimersByTimeAsync(0)
    expect(repair).toHaveBeenCalledOnce()
  })

  it('rejects late access results after playback resumes and aborts the check', async () => {
    const { run, checkSession, onPhaseChange } = setup()
    let resolve!: (value: PlaybackSessionResult) => void
    checkSession.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const repair = vi.fn()
    run.checkAccess(repair)
    run.report('playing')
    resolve('unauthorized')
    await Promise.resolve()
    expect(onPhaseChange).toHaveBeenLastCalledWith('playing')
    expect(checkSession.mock.calls[0][0].aborted).toBe(true)
    expect(repair).not.toHaveBeenCalled()
  })

  it('stops the adapter once and rejects all later work after access denial', async () => {
    const { run, stop } = setup()
    const repair = vi.fn()
    run.recover(repair, 1_000)
    expect(run.report('unauthorized')).toBe(true)
    expect(run.report('playing')).toBe(false)
    expect(run.report('unauthorized')).toBe(false)
    run.recover(repair)
    run.environmentChanged()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(repair).not.toHaveBeenCalled()
    expect(stop).toHaveBeenCalledOnce()
    expect(run.canRecover()).toBe(false)
    expect(run.allowsAutomaticPlay()).toBe(false)
  })

  it('lets recovery proceed after a bounded session check without claiming access expired', async () => {
    const { run, checkSession, stop } = setup()
    checkSession.mockReturnValueOnce(new Promise(() => {}))
    const repair = vi.fn()
    run.checkAccess(repair)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(repair).toHaveBeenCalledOnce()
    expect(stop).not.toHaveBeenCalled()
    expect(checkSession.mock.calls[0][0].aborted).toBe(true)
  })

  it('keeps failed access checks recoverable when the browser is offline', async () => {
    const { run, checkSession, environment, stop } = setup()
    checkSession.mockRejectedValueOnce(new TypeError('Network unavailable'))
    environment.online = false
    const repair = vi.fn()
    run.checkAccess(repair)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(repair).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
    environment.online = true
    run.environmentChanged()
    await vi.advanceTimersByTimeAsync(0)
    expect(repair).toHaveBeenCalledOnce()
  })

  it('does not restart the session-check deadline for repeated errors', async () => {
    const { run, checkSession } = setup()
    checkSession.mockReturnValueOnce(new Promise(() => {}))
    const repair = vi.fn()
    run.checkAccess(repair)
    await vi.advanceTimersByTimeAsync(4_000)
    run.checkAccess(repair)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(checkSession).toHaveBeenCalledOnce()
    expect(repair).toHaveBeenCalledOnce()
  })

  it('disposes pending work without stopping a replacement adapter', async () => {
    const { run, checkSession, stop } = setup()
    checkSession.mockReturnValueOnce(new Promise(() => {}))
    const repair = vi.fn()
    run.checkAccess(repair)
    run.dispose()
    run.recover(repair)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(repair).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
    expect(run.report('playing')).toBe(false)
  })

  it('asks the adapter to resume an interrupted run only when recovery is allowed', () => {
    const { run, resume, environment } = setup()
    run.report('reconnecting')
    environment.visible = false
    run.environmentChanged()
    expect(resume).not.toHaveBeenCalled()
    environment.visible = true
    run.environmentChanged()
    expect(resume).toHaveBeenCalledOnce()
    run.report('playing')
    run.environmentChanged()
    expect(resume).toHaveBeenCalledOnce()
  })
})

describe('playback run', () => {
  it('derives offline state without losing the current transport phase', () => {
    expect(visiblePlaybackState(false, 'playing')).toBe('offline')
    expect(visiblePlaybackState(true, 'reconnecting')).toBe('reconnecting')
  })

  it.each([
    { live: false, online: true, userPaused: false, visible: true },
    { live: true, online: false, userPaused: false, visible: true },
    { live: true, online: true, userPaused: true, visible: true },
    { live: true, online: true, userPaused: false, visible: false },
  ])('blocks recovery outside an active playback run: %o', (environment) => {
    expect(playbackCanRecover(environment)).toBe(false)
  })

  it('allows recovery while live, online, visible, and not user-paused', () => {
    expect(
      playbackCanRecover({
        live: true,
        online: true,
        userPaused: false,
        visible: true,
      }),
    ).toBe(true)
  })

  it('reports a stall after five unchanged progress samples', () => {
    const monitor = new PlaybackProgressMonitor()
    expect(monitor.observe(10, 0)).toEqual({ stable: false, stalled: false })
    for (let sample = 1; sample < 4; sample += 1) {
      expect(monitor.observe(10, sample * 1_000)).toEqual({
        stable: false,
        stalled: false,
      })
    }
    expect(monitor.observe(10, 4_000)).toEqual({ stable: false, stalled: true })
  })

  it('reports sustained progress after 60 seconds and resets on inactivity', () => {
    const monitor = new PlaybackProgressMonitor()
    monitor.observe(1, 0)
    monitor.observe(2, 1_000)
    expect(monitor.observe(3, 61_000)).toEqual({ stable: true, stalled: false })

    monitor.reset()
    expect(monitor.observe(3, 62_000)).toEqual({ stable: false, stalled: false })
  })
})
