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

async function renderPlayer() {
  render(<HlsPlayer channel={channel} />)
  await act(async () => Promise.resolve())
  return screen.getByLabelText('Late-night games live video') as HTMLVideoElement
}

describe('HlsPlayer recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.instances.length = 0
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

  it('uses manifest-driven latency instead of the old one-second override', async () => {
    await renderPlayer()
    expect(mocks.instances[0].config).toMatchObject({
      lowLatencyMode: true,
      backBufferLength: 30,
    })
    expect(mocks.instances[0].config).not.toHaveProperty('liveSyncDuration')
    expect(mocks.instances[0].config).not.toHaveProperty('liveMaxLatencyDuration')
    expect(mocks.instances[0].config).not.toHaveProperty('maxLiveSyncPlaybackRate')
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
})
