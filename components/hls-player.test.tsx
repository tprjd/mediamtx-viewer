import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { LevelUpdatedData } from 'hls.js'
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
    latestLevelDetails: LevelUpdatedData['details'] | null = null
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
      if (event === FakeHls.Events.LEVEL_UPDATED) {
        this.latestLevelDetails = (data as LevelUpdatedData).details
      }
      this.listeners.get(event)?.(event, data)
    }
  }

  return {
    FakeHls,
    instances,
    getSession: vi.fn(),
    playbackStats: vi.fn(),
    userPauseChange: undefined as ((paused: boolean) => void) | undefined,
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
      onUserPauseChange,
      onVideoElementChange,
      poster,
    }: {
      ariaLabel: string
      children?: React.ReactNode
      hlsConfig?: Record<string, unknown>
      onHlsInstanceChange?: (instance: FakeHlsInstance | null) => void
      onProviderKindChange?: (kind: 'hls' | 'native' | null) => void
      onUserPauseChange?: (paused: boolean) => void
      onVideoElementChange?: (video: HTMLVideoElement | null) => void
      poster?: string
    }) => {
      const videoRef = React.useRef<HTMLVideoElement>(null)

      mocks.userPauseChange = onUserPauseChange

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
    mocks.userPauseChange = undefined
    mocks.videoAlreadyPlaying = false
    mocks.FakeHls.isSupported = () => true
    vi.stubGlobal('MediaError', { MEDIA_ERR_SRC_NOT_SUPPORTED: 4 })
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
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each(['hls', 'native'] as const)('does not show session expired when a session check fails after playback resumes with %s', async (provider) => {
    if (provider === 'native') {
      mocks.FakeHls.isSupported = () => false
      vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('probably')
    }
    let resolveSession!: (result: unknown) => void
    mocks.getSession.mockReturnValueOnce(new Promise((resolve) => {
      resolveSession = resolve
    }))
    const video = await renderPlayer()
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(video, 'readyState', {
      configurable: true,
      value: HTMLMediaElement.HAVE_ENOUGH_DATA,
    })
    fireEvent.error(video)
    fireEvent.playing(video)

    await act(async () => {
      resolveSession({ data: null, error: { status: 503, message: 'Unavailable' } })
      await Promise.resolve()
    })

    expect(video.paused).toBe(false)
    expect(screen.queryByText('Session expired')).not.toBeInTheDocument()
  })

  it('does not recreate HLS when playback resumes before a pending retry', async () => {
    const video = await renderPlayer()
    act(() => {
      mocks.instances[0].emit('error', {
        fatal: true,
        type: 'networkError',
        details: 'manifestLoadError',
      })
    })
    fireEvent.playing(video)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(mocks.instances).toHaveLength(1)
    expect(screen.queryByText('Reconnecting')).not.toBeInTheDocument()
  })

  it('does not reconnect when a successful session check completes after playback resumes', async () => {
    let resolveSession!: (result: unknown) => void
    mocks.getSession.mockReturnValueOnce(new Promise((resolve) => {
      resolveSession = resolve
    }))
    const video = await renderPlayer()
    fireEvent.error(video)
    fireEvent.playing(video)

    await act(async () => {
      resolveSession({ data: { user: { id: 'user' } }, error: null })
      await Promise.resolve()
    })

    expect(screen.queryByText('Session expired')).not.toBeInTheDocument()
    expect(screen.queryByText('Reconnecting')).not.toBeInTheDocument()
  })

  it.each([
    { data: null, error: { status: 503, message: 'Unavailable' } },
    new TypeError('Failed to fetch'),
  ])('retries a media interruption when the session check is unavailable: %s', async (result) => {
    if (result instanceof Error) mocks.getSession.mockRejectedValueOnce(result)
    else mocks.getSession.mockResolvedValueOnce(result)
    const video = await renderPlayer()
    fireEvent.error(video)
    await act(async () => Promise.resolve())

    expect(screen.queryByText('Session expired')).not.toBeInTheDocument()
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(mocks.instances).toHaveLength(2)
  })

  it('stops media and pending retries when HLS confirms access is denied', async () => {
    const video = await renderPlayer()
    act(() => {
      mocks.instances[0].emit('error', {
        fatal: true,
        type: 'networkError',
        details: 'manifestLoadError',
      })
      mocks.instances[0].emit('error', {
        fatal: true,
        type: 'networkError',
        response: { code: 401 },
        details: 'manifestLoadError',
      })
    })

    expect(screen.getByText('Session expired')).toBeInTheDocument()
    expect(video.pause).toHaveBeenCalled()
    fireEvent.playing(video)
    await act(async () => vi.advanceTimersByTimeAsync(20_000))
    expect(mocks.instances).toHaveLength(1)
    expect(screen.getByText('Session expired')).toBeInTheDocument()
  })

  it.each(['hidden', 'offline', 'paused'])('defers a queued HLS retry while %s and resumes it once', async (condition) => {
    await renderPlayer()
    act(() => {
      mocks.instances[0].emit('error', {
        fatal: true,
        type: 'networkError',
        details: 'manifestLoadError',
      })
      if (condition === 'hidden') {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        fireEvent(document, new Event('visibilitychange'))
      } else if (condition === 'offline') {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
        fireEvent(window, new Event('offline'))
      } else {
        mocks.userPauseChange?.(true)
      }
    })
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(mocks.instances).toHaveLength(1)

    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
      mocks.userPauseChange?.(false)
      fireEvent(document, new Event('visibilitychange'))
      fireEvent(window, new Event('online'))
    })
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(mocks.instances).toHaveLength(2)
  })

  it('bounds a hung session check before retrying HLS', async () => {
    mocks.getSession.mockReturnValueOnce(new Promise(() => {}))
    const video = await renderPlayer()
    fireEvent.error(video)
    await act(async () => vi.advanceTimersByTimeAsync(5_999))
    expect(mocks.instances).toHaveLength(1)
    expect(screen.queryByText('Session expired')).not.toBeInTheDocument()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(mocks.instances).toHaveLength(2)
  })

  it.each([
    { data: null, error: null },
    { data: null, error: { status: 401, message: 'Unauthorized' } },
    { data: null, error: { status: 403, message: 'Forbidden' } },
  ])('stops native HLS when the session check confirms access is denied: %s', async (result) => {
    mocks.FakeHls.isSupported = () => false
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('probably')
    mocks.getSession.mockResolvedValueOnce(result)
    const video = await renderPlayer()
    fireEvent.error(video)
    await act(async () => Promise.resolve())

    expect(screen.getByText('Session expired')).toBeInTheDocument()
    expect(video.pause).toHaveBeenCalled()
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

  it('uses hls.js with a three-second latency and forward-buffer budget', async () => {
    await renderPlayer('ultra-low')
    expect(mocks.instances[0].config).toMatchObject({
      lowLatencyMode: true,
      liveSyncMode: 'edge',
      backBufferLength: 0,
      liveSyncDuration: 1.8,
      liveMaxLatencyDuration: 3,
      liveSyncOnStallIncrease: 0,
      maxLiveSyncPlaybackRate: 1.05,
      maxBufferLength: 2,
      maxMaxBufferLength: 2,
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

  it('rejects native fallback for the hls.js-only three-second mode', async () => {
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

  it('adapts the SLO ceiling for longer segments without demoting', async () => {
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

    // Base ultra-low hls.js config is kept (no player teardown on re-aim).
    expect(mocks.instances[0].config).toMatchObject({
      liveSyncDuration: 1.8,
      liveMaxLatencyDuration: 3,
    })

    // A 3s segment relaxes the SLO window instead of demoting.
    act(() => {
      mocks.instances[0].emit('levelUpdated', {
        details: {
          partTarget: 0.2,
          targetduration: 3,
          averagetargetduration: 3,
        },
      })
    })
    expect(onUltraLowUnavailable).not.toHaveBeenCalled()

    // Parts > 250ms are still a hard failure.
    act(() => {
      mocks.instances[0].emit('levelUpdated', {
        details: {
          partTarget: 0.4,
          targetduration: 2,
          averagetargetduration: 2,
        },
      })
    })
    expect(onUltraLowUnavailable).toHaveBeenCalledOnce()
  })

  it('does not demote when latency stays below the adaptive ceiling', async () => {
    const onUltraLowFailure = vi.fn()
    const onUltraLowUnavailable = vi.fn()
    await act(async () => {
      render(
        <HlsPlayer
          channel={channel}
          latencyProfile="ultra-low"
          onUltraLowFailure={onUltraLowFailure}
          onUltraLowUnavailable={onUltraLowUnavailable}
        />,
      )
      await Promise.resolve()
    })

    const video = screen.getByLabelText('Late-night games live video') as HTMLVideoElement
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    video.currentTime = 10
    mocks.instances[0].latency = 4
    fireEvent(video, new Event('playing'))

    // A 4.167s segment gives a 6s adaptive ceiling; 4s latency is tolerated.
    act(() => {
      mocks.instances[0].emit('levelUpdated', {
        details: {
          partTarget: 0.2,
          targetduration: 4.167,
          averagetargetduration: 4.167,
        },
      })
    })
    await act(async () => vi.advanceTimersByTimeAsync(1_500))
    expect(video.currentTime).toBe(10)
    expect(mocks.instances).toHaveLength(1)
    expect(onUltraLowFailure).not.toHaveBeenCalled()
    expect(onUltraLowUnavailable).not.toHaveBeenCalled()
    expect(mocks.playbackStats.mock.calls.at(-1)?.[0].hlsDiagnostics).toMatchObject({
      maxLatencySeconds: 6,
      forwardBufferLoadLimitSeconds: 2,
      configuredMaxForwardBufferSeconds: 4.75,
    })
    expect(mocks.instances[0].config).toMatchObject({
      maxBufferLength: 2,
      maxMaxBufferLength: 2,
    })
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

  it.each([
    { mode: 'balanced', target: 3, ceiling: 6 },
    { mode: 'smooth', target: 5, ceiling: 9 },
  ] as const)('discards learned timing when switching to $mode', async ({ mode, target, ceiling }) => {
    mocks.videoAlreadyPlaying = true
    const view = render(<HlsPlayer channel={channel} latencyProfile="ultra-low" />)
    await act(async () => Promise.resolve())
    act(() => {
      mocks.instances[0].emit('levelUpdated', {
        details: { partTarget: 0.2, targetduration: 4, averagetargetduration: 3.2 },
      })
    })
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(mocks.playbackStats.mock.calls.at(-1)?.[0].hlsDiagnostics).toMatchObject({
      targetLatencySeconds: 2.56,
      maxLatencySeconds: 3.36,
      measuredSegmentSeconds: 3.2,
    })

    view.rerender(<HlsPlayer channel={channel} latencyProfile={mode} />)
    await act(async () => Promise.resolve())
    const video = screen.getByLabelText('Late-night games live video') as HTMLVideoElement
    video.currentTime = 10
    mocks.instances.at(-1)!.latency = 4
    fireEvent(video, new Event('play'))

    expect(video.currentTime).toBe(10)
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(mocks.playbackStats.mock.calls.at(-1)?.[0].hlsDiagnostics).toMatchObject({
      targetLatencySeconds: target,
      maxLatencySeconds: ceiling,
      adaptiveTargetSeconds: undefined,
      adaptiveCeilingSeconds: undefined,
      measuredSegmentSeconds: undefined,
    })
  })

  it('discards learned timing when recovery replaces the HLS instance', async () => {
    await renderPlayer('ultra-low')
    act(() => {
      mocks.instances[0].emit('levelUpdated', {
        details: { partTarget: 0.2, targetduration: 5, averagetargetduration: 5 },
      })
    })
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(mocks.playbackStats.mock.calls.at(-1)?.[0].hlsDiagnostics).toMatchObject({
      targetLatencySeconds: 5,
      maxLatencySeconds: 6,
    })
    act(() => {
      mocks.instances[0].emit('error', {
        fatal: true, type: 'networkError', details: 'fragLoadError',
      })
    })
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(mocks.instances).toHaveLength(2)
    expect(mocks.playbackStats.mock.calls.at(-1)?.[0].hlsDiagnostics).toMatchObject({
      targetLatencySeconds: 1.8,
      maxLatencySeconds: 3,
      measuredSegmentSeconds: undefined,
    })
  })

  it('keeps the contract buffer margin after observing two-second segments', async () => {
    const video = await renderPlayer('ultra-low')
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    Object.defineProperty(video, 'buffered', {
      configurable: true,
      value: { length: 1, start: () => 0, end: () => 12.5 },
    })
    video.currentTime = 10
    fireEvent(video, new Event('playing'))
    act(() => {
      mocks.instances[0].emit('levelUpdated', {
        details: { partTarget: 0.2, targetduration: 2, averagetargetduration: 2 },
      })
    })
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(mocks.playbackStats.mock.calls.at(-1)?.[0].hlsDiagnostics).toMatchObject({
      forwardBufferLoadLimitSeconds: 2,
      configuredMaxForwardBufferSeconds: 3,
      forwardBufferBreachCount: 0,
    })
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

  it('recovers when an interruption pauses media without a user request', async () => {
    const video = await renderPlayer()
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    fireEvent(video, new Event('playing'))
    Object.defineProperty(video, 'paused', { configurable: true, value: true })

    await act(async () => {
      mocks.instances[0].emit('error', {
        fatal: true,
        type: 'networkError',
        details: 'fragLoadError',
      })
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(mocks.instances).toHaveLength(2)
  })

  it('does not override an explicit user pause during recovery', async () => {
    const video = await renderPlayer()
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    fireEvent(video, new Event('playing'))
    mocks.userPauseChange?.(true)
    Object.defineProperty(video, 'paused', { configurable: true, value: true })

    await act(async () => {
      mocks.instances[0].emit('error', {
        fatal: true,
        type: 'networkError',
        details: 'fragLoadError',
      })
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(mocks.instances).toHaveLength(1)
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

    await act(async () => vi.advanceTimersByTimeAsync(4_000))
    expect(mocks.instances[0].startLoad).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(1_000))
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
    mocks.instances[0].latency = 3.1
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
      value: { length: 1, start: () => 0, end: () => 13.5 },
    })
    video.currentTime = 10
    mocks.instances[0].latency = 3.1
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
      maxObservedForwardBufferSeconds: 3.5,
      maxObservedLatencySeconds: 3.1,
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
    mocks.instances[0].latency = 3.1
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
    mocks.instances[0].latency = 1.8
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
    mocks.instances[0].latency = 4
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
      expect.stringContaining('could not be maintained'),
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
