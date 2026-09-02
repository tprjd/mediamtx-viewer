import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HlsPlayer } from '@/components/hls-player'
import type { PublicChannel } from '@/lib/types'

interface FakeHlsInstance {
  config: Record<string, unknown>
  destroy: ReturnType<typeof vi.fn>
  startLoad: ReturnType<typeof vi.fn>
  recoverMediaError: ReturnType<typeof vi.fn>
  loadSource: ReturnType<typeof vi.fn>
  attachMedia: ReturnType<typeof vi.fn>
  liveSyncPosition: number | null
  latency: number
  emit(event: string, data?: unknown): void
}

const mocks = vi.hoisted(() => {
  const instances: FakeHlsInstance[] = []

  class FakeHls {
    static isSupported = () => true
    static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifestParsed' }
    readonly config: Record<string, unknown>
    readonly destroy = vi.fn()
    readonly startLoad = vi.fn()
    readonly recoverMediaError = vi.fn()
    readonly loadSource = vi.fn()
    readonly attachMedia = vi.fn()
    liveSyncPosition: number | null = 20
    latency = 3
    playingDate: Date | null = null
    latestLevelDetails = {
      partHoldBack: 0.5,
      partTarget: 0.2,
      targetduration: 2,
    }
    private listeners = new Map<string, (...args: unknown[]) => void>()

    constructor(config: Record<string, unknown>) {
      this.config = config
      instances.push(this)
    }

    on(event: string, listener: (...args: unknown[]) => void) {
      this.listeners.set(event, listener)
    }

    emit(event: string, data?: unknown) {
      this.listeners.get(event)?.(event, data)
    }
  }

  return { FakeHls, instances, getSession: vi.fn() }
})

vi.mock('hls.js', () => ({
  default: mocks.FakeHls,
  ErrorDetails: { BUFFER_INCOMPATIBLE_CODECS_ERROR: 'bufferIncompatibleCodecsError' },
  ErrorTypes: { MEDIA_ERROR: 'mediaError', NETWORK_ERROR: 'networkError' },
}))

vi.mock('@/components/playback-stats', () => ({ PlaybackStats: () => null }))
vi.mock('@/lib/auth/client', () => ({
  authClient: { getSession: mocks.getSession },
}))

const channel: PublicChannel = {
  slug: 'live',
  ownerName: 'David',
  title: 'Late-night games',
  accentColor: '#8b5cf6',
  preferredPlayback: 'hls',
  hasCompatibilityFallback: false,
  playback: {
    hls: '/media/hls/live/index.m3u8',
    webrtc: '/media/whep/live/whep',
  },
  status: {
    state: 'live',
    live: true,
    startedAt: '2026-08-30T12:00:00.000Z',
    tracks: ['Opus', 'AV1'],
    viewerCount: 1,
    checkedAt: '2026-08-30T12:00:00.000Z',
  },
}

async function renderPlayer(
  latencyProfile: 'balanced' | 'smooth' = 'balanced',
) {
  render(<HlsPlayer channel={channel} latencyProfile={latencyProfile} />)
  await act(async () => Promise.resolve())
  return screen.getByLabelText('Late-night games live video') as HTMLVideoElement
}

describe('HlsPlayer recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.instances.length = 0
    mocks.FakeHls.isSupported = () => true
    mocks.getSession.mockResolvedValue({ data: { user: { id: 'user' } } })
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('')
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('uses the bounded balanced latency profile', async () => {
    await renderPlayer()
    expect(mocks.instances[0].config).toMatchObject({
      lowLatencyMode: true,
      backBufferLength: 30,
      liveSyncDuration: 3,
      liveMaxLatencyDuration: 6,
      maxLiveSyncPlaybackRate: 1.03,
      liveSyncOnStallIncrease: 0.5,
    })
  })

  it('uses a larger recovery margin and gentler catch-up in smooth mode', async () => {
    await renderPlayer('smooth')
    expect(mocks.instances[0].config).toMatchObject({
      liveSyncDuration: 5,
      liveMaxLatencyDuration: 9,
      maxLiveSyncPlaybackRate: 1.02,
      liveSyncOnStallIncrease: 1,
    })
  })

  it('uses hls.js for balanced and keeps native HLS for smooth when both work', async () => {
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue(
      'probably',
    )
    await renderPlayer('balanced')
    expect(mocks.instances).toHaveLength(1)

    cleanup()
    mocks.instances.length = 0
    const video = await renderPlayer('smooth')
    expect(mocks.instances).toHaveLength(0)
    expect(video.src).toContain('/media/hls/live/index.m3u8')
  })

  it('recreates the HLS instance when the latency profile changes', async () => {
    const view = render(
      <HlsPlayer channel={channel} latencyProfile="balanced" />,
    )
    await act(async () => Promise.resolve())

    view.rerender(<HlsPlayer channel={channel} latencyProfile="smooth" />)
    await act(async () => Promise.resolve())

    expect(mocks.instances).toHaveLength(2)
    expect(mocks.instances[0].destroy).toHaveBeenCalledOnce()
    expect(mocks.instances[1].config).toMatchObject({ liveSyncDuration: 5 })
  })

  it('recreates HLS with bounded backoff after fatal network errors', async () => {
    await renderPlayer()

    await act(async () => {
      mocks.instances[0].emit('error', {
        fatal: true,
        type: 'networkError',
        details: 'fragLoadError',
      })
      await vi.advanceTimersByTimeAsync(999)
    })
    expect(mocks.instances).toHaveLength(1)

    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(mocks.instances).toHaveLength(2)

    await act(async () => {
      mocks.instances[1].emit('error', {
        fatal: true,
        type: 'networkError',
        details: 'fragLoadError',
      })
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(mocks.instances).toHaveLength(3)
  })

  it('soft-recovers a frozen live edge before recreating the HLS instance', async () => {
    const video = await renderPlayer()
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    Object.defineProperty(video, 'getVideoPlaybackQuality', {
      configurable: true,
      value: () => ({ totalVideoFrames: 10 }),
    })
    fireEvent(video, new Event('playing'))

    await act(async () => vi.advanceTimersByTimeAsync(5_000))
    expect(mocks.instances[0].startLoad).toHaveBeenCalledOnce()
    expect(video.currentTime).toBe(20)

    await act(async () => vi.advanceTimersByTimeAsync(6_000))
    expect(mocks.instances).toHaveLength(2)
  })

  it('does not reconnect a frozen player while the tab is hidden', async () => {
    const video = await renderPlayer()
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    fireEvent(video, new Event('playing'))

    await act(async () => vi.advanceTimersByTimeAsync(20_000))
    expect(mocks.instances[0].startLoad).not.toHaveBeenCalled()
    expect(mocks.instances).toHaveLength(1)
  })

  it('bounds native HLS latency after three safe consecutive samples', async () => {
    mocks.FakeHls.isSupported = () => false
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue(
      'probably',
    )
    const video = await renderPlayer()
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    Object.defineProperty(video, 'seekable', {
      configurable: true,
      value: {
        length: 1,
        start: () => 0,
        end: () => 20,
      },
    })
    Object.defineProperty(video, 'buffered', {
      configurable: true,
      value: {
        length: 1,
        start: () => 0,
        end: () => 20,
      },
    })
    video.currentTime = 10
    fireEvent(video, new Event('playing'))

    await act(async () => vi.advanceTimersByTimeAsync(3_000))

    expect(mocks.instances).toHaveLength(0)
    expect(video.currentTime).toBe(17)
  })

  it('does not correct native HLS latency while paused or hidden', async () => {
    mocks.FakeHls.isSupported = () => false
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue(
      'probably',
    )
    const video = await renderPlayer()
    Object.defineProperty(video, 'paused', { configurable: true, value: true })
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    Object.defineProperty(video, 'seekable', {
      configurable: true,
      value: { length: 1, start: () => 0, end: () => 20 },
    })
    Object.defineProperty(video, 'buffered', {
      configurable: true,
      value: { length: 1, start: () => 0, end: () => 20 },
    })
    video.currentTime = 10

    await act(async () => vi.advanceTimersByTimeAsync(4_000))
    expect(video.currentTime).toBe(10)

    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    await act(async () => vi.advanceTimersByTimeAsync(4_000))
    expect(video.currentTime).toBe(10)
  })

  it('reports balanced unavailable when active native HLS has no live edge', async () => {
    mocks.FakeHls.isSupported = () => false
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue(
      'probably',
    )
    const onBalancedUnavailable = vi.fn()
    render(
      <HlsPlayer
        channel={channel}
        latencyProfile="balanced"
        onBalancedUnavailable={onBalancedUnavailable}
      />,
    )
    await act(async () => Promise.resolve())
    const video = screen.getByLabelText(
      'Late-night games live video',
    ) as HTMLVideoElement
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    fireEvent(video, new Event('playing'))

    await act(async () => vi.advanceTimersByTimeAsync(5_000))

    expect(onBalancedUnavailable).toHaveBeenCalledOnce()
  })
})
