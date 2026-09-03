import { describe, expect, it } from 'vitest'

import {
  playbackCanRecover,
  PlaybackProgressMonitor,
  visiblePlaybackState,
} from '@/lib/playback-run'

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
