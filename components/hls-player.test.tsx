import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HlsPlayer } from '@/components/hls-player'
import type { PublicChannel } from '@/lib/types'

interface FakeHlsInstance {
  config: Record<string, unknown>
  destroy: ReturnType<typeof vi.fn>
  stopLoad: ReturnType<typeof vi.fn>
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
    static Events = {
      ERROR: 'error',
      LEVEL_UPDATED: 'levelUpdated',
      MANIFEST_PARSED: 'manifestParsed',
    }
    readonly config: Record<string, unknown>
    readonly destroy = vi.fn()
    readonly stopLoad = vi.fn()
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

    off(event: string, listener: (...args: unknown[]) => void) {
      if (this.listeners.get(event) === listener) this.listeners.delete(event)
    }

    emit(event: string, data?: unknown) {
      this.listeners.get(event)?.(event, data)
    }
  }

  return {
    FakeHls,
    instances,
    getSession: vi.fn(),
    playbackStats: vi.fn(),
    videoAlreadyPlaying: false,
  }
})

vi.mock('hls.js', () => ({
  default: mocks.FakeHls,
  ErrorDetails: { BUFFER_INCOMPATIBLE_CODECS_ERROR: 'bufferIncompatibleCodecsError' },
  ErrorTypes: { MEDIA_ERROR: 'mediaError', NETWORK_ERROR: 'networkError' },
}))

vi.mock('@/components/playback-stats', () => ({
  PlaybackStats: (props: unknown) => {
    mocks.playbackStats(props)
    return null
  },
}))
vi.mock('@/components/vidstack-player', async () => {
  const React = await import('react')

  return {
    VidstackPlayer: ({
      ariaLabel,
      children,
      hlsConfig,
      onHlsInstanceChange,
      onProviderKindChange,
      onVideoElementChange,
      poster,
    }: {
      ariaLabel: string
      children?: React.ReactNode
      hlsConfig?: Record<string, unknown>
      onHlsInstanceChange?: (instance: FakeHlsInstance | null) => void
      onProviderKindChange?: (kind: 'hls' | 'native' | null) => void
      onVideoElementChange?: (video: HTMLVideoElement | null) => void
      poster?: string
    }) => {
      const videoRef = React.useRef<HTMLVideoElement>(null)

      React.useEffect(() => {
        const video = videoRef.current
        if (!video) return

        if (mocks.videoAlreadyPlaying) {
          Object.defineProperty(video, 'paused', {
            configurable: true,
            value: false,
          })
          Object.defineProperty(video, 'readyState', {
            configurable: true,
            value: HTMLMediaElement.HAVE_ENOUGH_DATA,
          })
        }
        onVideoElementChange?.(video)
        if (mocks.FakeHls.isSupported()) {
          const instance = new mocks.FakeHls(hlsConfig ?? {})
          onProviderKindChange?.('hls')
          onHlsInstanceChange?.(instance)
          return () => {
            instance.destroy()
            onHlsInstanceChange?.(null)
            onProviderKindChange?.(null)
            onVideoElementChange?.(null)
          }
        }

        onProviderKindChange?.('native')
        return () => {
          onProviderKindChange?.(null)
          onVideoElementChange?.(null)
        }
      }, [
        hlsConfig,
        onHlsInstanceChange,
        onProviderKindChange,
        onVideoElementChange,
      ])

      return (
        <div>
          <video aria-label={ariaLabel} poster={poster} ref={videoRef} />
          {children}
        </div>
      )
    },
  }
})
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
  latencyProfile: 'ultra-low' | 'balanced' | 'smooth' = 'balanced',
) {
  render(<HlsPlayer channel={channel} latencyProfile={latencyProfile} />)
  await act(async () => Promise.resolve())
  return screen.getByLabelText('Late-night games live video') as HTMLVideoElement
}

describe('HlsPlayer recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.instances.length = 0
    mocks.playbackStats.mockClear()
    mocks.videoAlreadyPlaying = false
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
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
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
      liveSyncMode: 'edge',
      backBufferLength: 30,
      liveSyncDuration: 3,
      liveMaxLatencyDuration: 6,
      maxLiveSyncPlaybackRate: 1.03,
      liveSyncOnStallIncrease: 0.5,
    })
  })

  it('recognizes playback that started before recovery listeners attach', async () => {
    mocks.videoAlreadyPlaying = true

    await renderPlayer()

    expect(
      screen.queryByRole('heading', { name: 'Joining stream' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('HLS · Balanced')).toBeInTheDocument()
  })

  it('uses hls.js with a two-second latency and forward-buffer budget', async () => {
    await renderPlayer('ultra-low')
    expect(mocks.instances[0].config).toMatchObject({
      lowLatencyMode: true,
      liveSyncMode: 'edge',
      backBufferLength: 0,
      liveSyncDuration: 1.2,
      liveMaxLatencyDuration: 2,
      liveSyncOnStallIncrease: 0,
      maxLiveSyncPlaybackRate: 1.05,
      maxBufferLength: 1.8,
      maxMaxBufferLength: 1.8,
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

  it('uses hls.js for every HLS profile when MSE and native HLS both work', async () => {
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue(
      'probably',
    )
    for (const profile of ['ultra-low', 'balanced', 'smooth'] as const) {
      await renderPlayer(profile)
      expect(mocks.instances).toHaveLength(1)
      cleanup()
      mocks.instances.length = 0
    }
  })

  it('rejects native fallback for the hls.js-only two-second mode', async () => {
    mocks.FakeHls.isSupported = () => false
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue(
      'probably',
    )
    const onUltraLowUnavailable = vi.fn()
    render(
      <HlsPlayer
        channel={channel}
        latencyProfile="ultra-low"
        onUltraLowUnavailable={onUltraLowUnavailable}
      />,
    )

    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(mocks.instances).toHaveLength(0)
    expect(onUltraLowUnavailable).toHaveBeenCalledOnce()
  })

  it('reports unsupported playback when hls.js and native HLS are unavailable', async () => {
    mocks.FakeHls.isSupported = () => false
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('')

    render(<HlsPlayer channel={channel} latencyProfile="balanced" />)
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(
      screen.getByRole('heading', { name: 'Video format not supported' }),
    ).toBeInTheDocument()
  })

  it('rejects playlists whose segment or part timing cannot meet the SLO', async () => {
    const onUltraLowUnavailable = vi.fn()
    await act(async () => {
      render(
        <HlsPlayer
          channel={channel}
          latencyProfile="ultra-low"
          onUltraLowUnavailable={onUltraLowUnavailable}
        />,
      )
      await Promise.resolve()
    })

    act(() => {
      mocks.instances[0].emit('levelUpdated', {
        details: {
          partTarget: 0.2,
          targetduration: 1,
        },
      })
    })
    expect(onUltraLowUnavailable).not.toHaveBeenCalled()

    act(() => {
      mocks.instances[0].emit('levelUpdated', {
        details: {
          partTarget: 0.2,
          targetduration: 2,
        },
      })
    })

    expect(onUltraLowUnavailable).toHaveBeenCalledOnce()
    expect(onUltraLowUnavailable).toHaveBeenCalledWith(
      expect.stringContaining('one-second LL-HLS segments'),
    )
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

  it('corrects ultra-low latency on the first active 250ms sample', async () => {
    const video = await renderPlayer('ultra-low')
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    video.currentTime = 10
    mocks.instances[0].latency = 2.1
    mocks.instances[0].liveSyncPosition = 20
    fireEvent(video, new Event('playing'))

    await act(async () => vi.advanceTimersByTimeAsync(250))

    expect(video.currentTime).toBe(20)
  })

  it('publishes ultra-low latency and forward-buffer SLO breaches', async () => {
    const video = await renderPlayer('ultra-low')
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    Object.defineProperty(video, 'buffered', {
      configurable: true,
      value: { length: 1, start: () => 0, end: () => 13 },
    })
    video.currentTime = 10
    mocks.instances[0].latency = 2.1
    mocks.instances[0].liveSyncPosition = 20
    fireEvent(video, new Event('playing'))

    await act(async () => vi.advanceTimersByTimeAsync(1_000))

    const latest = mocks.playbackStats.mock.calls.at(-1)?.[0] as {
      hlsDiagnostics: {
        correctiveSeekCount: number
        forwardBufferBreachCount: number
        lastBreachMetric: string
        latencyBreachCount: number
        maxObservedForwardBufferSeconds: number
        maxObservedLatencySeconds: number
      }
    }
    expect(latest.hlsDiagnostics).toMatchObject({
      correctiveSeekCount: 1,
      forwardBufferBreachCount: 1,
      latencyBreachCount: 1,
      maxObservedForwardBufferSeconds: 3,
      maxObservedLatencySeconds: 2.1,
    })
    expect(['forwardBuffer', 'liveLatency']).toContain(
      latest.hlsDiagnostics.lastBreachMetric,
    )
  })

  it('recreates ultra-low playback when latency stays high after correction', async () => {
    const video = await renderPlayer('ultra-low')
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    video.currentTime = 10
    mocks.instances[0].latency = 2.1
    mocks.instances[0].liveSyncPosition = 20
    fireEvent(video, new Event('playing'))

    await act(async () => vi.advanceTimersByTimeAsync(1_251))

    expect(mocks.instances).toHaveLength(2)
  })

  it('does not seek when only the ultra-low forward buffer exceeds its SLO', async () => {
    const video = await renderPlayer('ultra-low')
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    Object.defineProperty(video, 'buffered', {
      configurable: true,
      value: { length: 1, start: () => 0, end: () => 5 },
    })
    video.currentTime = 1
    mocks.instances[0].latency = 1.2
    mocks.instances[0].liveSyncPosition = 4
    fireEvent(video, new Event('playing'))

    await act(async () => vi.advanceTimersByTimeAsync(500))

    expect(video.currentTime).toBe(1)
    expect(mocks.instances).toHaveLength(1)
  })

  it('does not enforce the ultra-low SLO while paused, hidden, or seeking', async () => {
    const video = await renderPlayer('ultra-low')
    Object.defineProperty(video, 'paused', { configurable: true, value: true })
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    video.currentTime = 10
    mocks.instances[0].latency = 3
    mocks.instances[0].liveSyncPosition = 20

    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(video.currentTime).toBe(10)

    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    fireEvent(video, new Event('playing'))
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(video.currentTime).toBe(10)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    Object.defineProperty(video, 'seeking', { configurable: true, value: true })
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(video.currentTime).toBe(10)

    Object.defineProperty(video, 'seeking', { configurable: true, value: false })
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(video.currentTime).toBe(10)
  })

  it('reports repeated ultra-low stalls within 30 seconds', async () => {
    const onUltraLowFailure = vi.fn()
    render(
      <HlsPlayer
        channel={channel}
        latencyProfile="ultra-low"
        onUltraLowFailure={onUltraLowFailure}
      />,
    )
    await act(async () => Promise.resolve())
    const video = screen.getByLabelText(
      'Late-night games live video',
    ) as HTMLVideoElement
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    fireEvent(video, new Event('playing'))

    fireEvent(video, new Event('waiting'))
    fireEvent(video, new Event('stalled'))
    expect(onUltraLowFailure).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(1_001))
    fireEvent(video, new Event('waiting'))

    expect(onUltraLowFailure).toHaveBeenCalledOnce()
    expect(onUltraLowFailure).toHaveBeenCalledWith(
      expect.stringContaining('Switched to Balanced'),
    )
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
