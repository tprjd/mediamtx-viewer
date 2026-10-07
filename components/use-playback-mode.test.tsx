import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePlaybackMode } from './use-playback-mode'

const storageKey = 'mediamtx-viewer:playback-mode'
const options: Parameters<typeof usePlaybackMode>[0] = {
  live: true,
  preferredPlayback: 'hls',
  streamStartedAt: '2026-10-07T10:00:00Z',
  supportsUltraLow: () => true,
  tracks: ['H264', 'Opus'],
}
const advance = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
beforeEach(() => {
  sessionStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
})
afterEach(() => { cleanup(); vi.useRealTimers() })

it('rejects an unsupported user selection without changing the saved preference', async () => {
  const { result } = renderHook(usePlaybackMode, { initialProps: { ...options, supportsUltraLow: () => false } })
  await advance()
  act(() => result.current.selectMode('ultra-low'))
  expect(result.current.mode).toBe('balanced')
  expect(sessionStorage.getItem(storageKey)).toBeNull()
})

it('rejects unknown choices and preserves the reason when capability disappears', async () => {
  const { result } = renderHook(usePlaybackMode, { initialProps: options })
  await advance()
  expect(result.current.selectableModes).toEqual(['ultra-low', 'balanced', 'smooth', 'webrtc'])
  act(() => result.current.selectMode('ultra-low'))
  act(() => result.current.onUltraLowUnavailable('Browser support changed.'))
  expect(result.current.selectableModes).not.toContain('ultra-low')
  act(() => { result.current.selectMode('ultra-low'); result.current.selectMode('unknown') })
  expect(result.current.mode).toBe('balanced')
  expect(result.current.modeExitReason).toBe('Browser support changed.')
  expect(sessionStorage.getItem(storageKey)).toBe('balanced')
})

it.each([
  { name: 'incompatible tracks', input: { ...options, tracks: ['H264', 'MPEG-4 Audio'] } },
  { name: 'an offline Channel', input: { ...options, live: false } },
])('rejects a WebRTC user choice for $name', async ({ input }) => {
  const { result } = renderHook(usePlaybackMode, { initialProps: input })
  await advance()
  expect(result.current.selectableModes).not.toContain('webrtc')
  act(() => result.current.selectMode('webrtc'))
  expect(result.current.mode).toBe('balanced')
  expect(sessionStorage.getItem(storageKey)).toBeNull()
})

it('restores a compatible saved WebRTC preference while offline without offering it as a user choice', async () => {
  sessionStorage.setItem(storageKey, 'webrtc')
  const { result } = renderHook(usePlaybackMode, { initialProps: { ...options, live: false } })
  await advance()
  expect(result.current.mode).toBe('webrtc')
  expect(result.current.selectableModes).not.toContain('webrtc')
  expect(sessionStorage.getItem(storageKey)).toBe('webrtc')
})

it('keeps Balanced ineligible across restarts but still permits the contract fallback to Balanced', async () => {
  const { result, rerender } = renderHook(usePlaybackMode, { initialProps: options })
  await advance()
  act(() => result.current.onBalancedUnavailable())
  expect(result.current.mode).toBe('smooth')
  act(() => result.current.selectMode('balanced'))
  expect(result.current.mode).toBe('smooth')
  expect(sessionStorage.getItem(storageKey)).toBe('smooth')
  rerender({ ...options, streamStartedAt: '2026-10-07T12:05:00Z' })
  expect(result.current.selectableModes).not.toContain('balanced')
  act(() => result.current.selectMode('ultra-low'))
  act(() => result.current.onUltraLowFailure('Latency target missed.'))
  expect(result.current.mode).toBe('balanced')
  expect(result.current.modeExitReason).toContain('Latency target missed.')
  expect(sessionStorage.getItem(storageKey)).toBe('balanced')
  expect(result.current.selectableModes).not.toContain('balanced')
  // A capability refresh rehydrates the saved mode under its original rules.
  rerender({ ...options, tracks: ['H264', 'MPEG-4 Audio'] })
  await advance()
  expect(result.current.mode).toBe('balanced')
  expect(result.current.selectableModes).not.toContain('balanced')
})

it('rejects WebRTC during the cooldown and offers it after expiry without switching automatically', async () => {
  const { result } = renderHook(usePlaybackMode, { initialProps: options })
  await advance()
  act(() => result.current.selectMode('webrtc'))
  act(() => result.current.onWebRtcFallback())
  expect(result.current.mode).toBe('smooth')
  // Commit the last whole-second tick before advancing to the expiry edge.
  // Otherwise React batches it until 59,999 ms and re-arms the interval there.
  await advance(59_000)
  await advance(999)
  expect(result.current.selectableModes).not.toContain('webrtc')
  act(() => result.current.selectMode('webrtc'))
  expect(result.current.mode).toBe('smooth')
  expect(sessionStorage.getItem(storageKey)).toBe('smooth')
  await advance(1)
  expect(result.current.selectableModes).toContain('webrtc')
  expect(result.current.mode).toBe('smooth')
  act(() => result.current.selectMode('webrtc'))
  expect(result.current.mode).toBe('webrtc')
})

it('releases the WebRTC cooldown for a new broadcast but not for a repeated status update', async () => {
  const { result, rerender } = renderHook(usePlaybackMode, { initialProps: options })
  await advance()
  act(() => result.current.onWebRtcFallback())
  rerender({ ...options })
  expect(result.current.selectableModes).not.toContain('webrtc')
  rerender({ ...options, streamStartedAt: '2026-10-07T12:01:00Z' })
  expect(result.current.selectableModes).toContain('webrtc')
  expect(result.current.mode).toBe('smooth')
  act(() => result.current.selectMode('webrtc'))
  expect(result.current.mode).toBe('webrtc')
})

it('keeps codec and cooldown requirements independent as tracks change', async () => {
  const { result, rerender } = renderHook(usePlaybackMode, { initialProps: options })
  await advance()
  act(() => result.current.onWebRtcFallback())
  rerender({ ...options, tracks: ['H264', 'MPEG-4 Audio'] })
  await advance()
  rerender(options)
  await advance()
  expect(result.current.selectableModes).not.toContain('webrtc')
  expect(result.current.mode).toBe('smooth')
  rerender({ ...options, tracks: ['H264', 'MPEG-4 Audio'] })
  await advance(60_000)
  expect(result.current.selectableModes).not.toContain('webrtc')
  rerender(options)
  await advance()
  expect(result.current.selectableModes).toContain('webrtc')
  expect(result.current.mode).toBe('smooth')
})

it('leaves active WebRTC when the track set becomes incompatible and normalizes the preference', async () => {
  const { result, rerender } = renderHook(usePlaybackMode, { initialProps: options })
  await advance()
  act(() => result.current.selectMode('webrtc'))
  rerender({ ...options, tracks: ['H264', 'MPEG-4 Audio'] })
  await advance()
  expect(result.current.mode).toBe('balanced')
  expect(result.current.selectableModes).not.toContain('webrtc')
  expect(result.current.modeExitReason).toContain('audio codec')
  expect(sessionStorage.getItem(storageKey)).toBe('balanced')
})
