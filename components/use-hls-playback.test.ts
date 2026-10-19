import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { useEffect } from 'react'
import type Hls from 'hls.js'
import type { LevelUpdatedData } from 'hls.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useHlsPlayback, type HlsPlaybackOptions } from '@/components/use-hls-playback'
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
  queueEvent(event: string, data?: unknown): () => void
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

    queueEvent(event: string, data?: unknown) {
      const listener = this.listeners.get(event)
      return () => listener?.(event, data)
    }
  }

  return {
    FakeHls,
    instances,
    getSession: vi.fn(),
    videoAlreadyPlaying: false,
  }
})

vi.mock('hls.js', () => ({
  default: mocks.FakeHls,
  ErrorDetails: { BUFFER_INCOMPATIBLE_CODECS_ERROR: 'bufferIncompatibleCodecsError' },
  ErrorTypes: { MEDIA_ERROR: 'mediaError', NETWORK_ERROR: 'networkError' },
}))

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

let playback: { current: ReturnType<typeof useHlsPlayback> }

function renderPlayback(options: HlsPlaybackOptions) {
  const view = renderHook((props: HlsPlaybackOptions) => {
    const result = useHlsPlayback(props)
    const { playerKey, playerProps: { hlsConfig, onProviderAttachmentChange } } = result
    // Supply the external provider lifecycle through the production interface.
    useEffect(() => {
      const video = document.createElement('video')
      if (mocks.videoAlreadyPlaying) {
        Object.defineProperty(video, 'paused', { configurable: true, value: false })
        Object.defineProperty(video, 'readyState', { configurable: true, value: HTMLMediaElement.HAVE_ENOUGH_DATA })
      }
      const instance = mocks.FakeHls.isSupported() ? new mocks.FakeHls(hlsConfig) : undefined
      onProviderAttachmentChange(instance
        ? { kind: 'hls', video, hls: instance as unknown as Hls }
        : { kind: 'native', video })
      return () => {
        onProviderAttachmentChange(null)
        instance?.destroy()
      }
    }, [playerKey, hlsConfig, onProviderAttachmentChange])
    return result
  }, { initialProps: options })
  playback = view.result
  return view
}

async function renderPlayer(
  latencyProfile: 'ultra-low' | 'balanced' | 'smooth' = 'balanced',
) {
  renderPlayback({ channel, latencyProfile })
  await act(async () => Promise.resolve())
  return playback.current.videoRef.current!
}

describe('useHlsPlayback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.instances.length = 0
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

  it('selects the compatibility source and retries it through the HLS interface', () => {
    const compatibleChannel = {
      ...channel,
      hasCompatibilityFallback: true,
      playback: { ...channel.playback, fallbackHls: '/media/hls/compatible/index.m3u8' },
    }
    renderPlayback({ channel: compatibleChannel, latencyProfile: 'balanced' })
    const originalKey = playback.current.playerKey
    expect(playback.current.playerProps.src?.src).toBe(channel.playback.hls)

    act(() => playback.current.selectCompatibilityStream())
    expect(playback.current.playerProps.src?.src).toBe(compatibleChannel.playback.fallbackHls)
    expect(playback.current.usingFallback).toBe(true)
    expect(playback.current.playerKey).not.toBe(originalKey)

    const fallbackKey = playback.current.playerKey
    act(() => playback.current.retry())
    expect(playback.current.playerKey).not.toBe(fallbackKey)
    expect(playback.current.playerProps.src?.src).toBe(compatibleChannel.playback.fallbackHls)
    expect(mocks.instances).toHaveLength(3)
  })

  it('leaves the first fatal media recovery to Vidstack and retries after a repeated error', async () => {
    await renderPlayer('smooth')
    const instance = mocks.instances[0]
    const error = { fatal: true, type: 'mediaError', details: 'bufferAppendError' }
    act(() => instance.emit('error', error))
    expect(playback.current.state).toBe('reconnecting')
    expect(instance.recoverMediaError).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(mocks.instances).toHaveLength(1)

    act(() => instance.emit('error', error))
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(instance.recoverMediaError).not.toHaveBeenCalled()
    expect(mocks.instances).toHaveLength(2)
  })

  it('removes the source and cancels recovery when the Channel goes offline', async () => {
    const view = renderPlayback({ channel, latencyProfile: 'balanced' })
    const retiredError = mocks.instances[0].queueEvent('error', {
      fatal: true, type: 'networkError', details: 'fragLoadError',
    })
    act(retiredError)
    view.rerender({
      channel: { ...channel, status: { ...channel.status, state: 'offline', live: false } },
      latencyProfile: 'balanced',
    })
    act(retiredError)
    await act(async () => vi.advanceTimersByTimeAsync(15_000))

    expect(playback.current.state).toBe('offline')
    expect(playback.current.playerProps.src).toBeUndefined()
    expect(playback.current.videoRef.current?.pause).toHaveBeenCalled()
    expect(mocks.instances).toHaveLength(1)
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
    expect(playback.current.state).not.toBe('unauthorized')
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
    expect(playback.current.state).not.toBe('reconnecting')
  })

  it.each(['replacement', 'unmount'])('retires queued HLS events and pending retries on %s', async (action) => {
    const onUltraLowUnavailable = vi.fn()
    const view = renderPlayback(
      { channel, latencyProfile: 'ultra-low', onUltraLowUnavailable },
    )
    await act(async () => Promise.resolve())
    const retired = mocks.instances[0]
    const latePlaylist = retired.queueEvent('levelUpdated', { details: { partTarget: 1 } })
    act(() => retired.emit('error', {
      fatal: true, type: 'networkError', details: 'fragLoadError',
    }))

    if (action === 'replacement') {
      view.rerender({ channel, latencyProfile: 'smooth', onUltraLowUnavailable })
    } else {
      view.unmount()
    }
    await act(async () => {
      latePlaylist()
      retired.emit('manifestParsed')
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(onUltraLowUnavailable).not.toHaveBeenCalled()
    expect(mocks.instances).toHaveLength(action === 'replacement' ? 2 : 1)
  })

  it('retires the attachment before React processes the provider change', async () => {
    const onUltraLowUnavailable = vi.fn()
    renderPlayback({ channel, latencyProfile: 'ultra-low', onUltraLowUnavailable })
    await act(async () => Promise.resolve())
    const latePlaylist = mocks.instances[0].queueEvent('levelUpdated', { details: { partTarget: 1 } })

    act(() => {
      playback.current.playerProps.onProviderAttachmentChange(null)
      latePlaylist()
    })

    expect(onUltraLowUnavailable).not.toHaveBeenCalled()
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

    expect(playback.current.state).not.toBe('unauthorized')
    expect(playback.current.state).not.toBe('reconnecting')
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

    expect(playback.current.state).not.toBe('unauthorized')
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

    expect(playback.current.state).toBe('unauthorized')
    expect(video.pause).toHaveBeenCalled()
    fireEvent.playing(video)
    await act(async () => vi.advanceTimersByTimeAsync(20_000))
    expect(mocks.instances).toHaveLength(1)
    expect(playback.current.state).toBe('unauthorized')
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
        playback.current.playerProps.onUserPauseChange(true)
      }
    })
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(mocks.instances).toHaveLength(1)

    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
      playback.current.playerProps.onUserPauseChange(false)
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
    expect(playback.current.state).not.toBe('unauthorized')
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

    expect(playback.current.state).toBe('unauthorized')
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

    expect(playback.current.state).toBe('playing')
    expect(playback.current.label).toBe('Balanced')
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
    renderPlayback(
      { channel, latencyProfile: 'ultra-low', onUltraLowUnavailable },
    )

    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(mocks.instances).toHaveLength(0)
    expect(onUltraLowUnavailable).toHaveBeenCalledOnce()
  })

  it('reports unsupported playback when hls.js and native HLS are unavailable', async () => {
    mocks.FakeHls.isSupported = () => false
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('')

    renderPlayback({ channel, latencyProfile: 'balanced' })
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(playback.current.state).toBe('unsupported')
  })

  it('adapts the SLO ceiling for longer segments without demoting', async () => {
    const onUltraLowUnavailable = vi.fn()
    await act(async () => {
      renderPlayback(
        { channel, latencyProfile: 'ultra-low', onUltraLowUnavailable },
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
      renderPlayback(
        { channel, latencyProfile: 'ultra-low', onUltraLowFailure, onUltraLowUnavailable },
      )
      await Promise.resolve()
    })

    const video = playback.current.videoRef.current!
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
    expect(playback.current.diagnostics).toMatchObject({
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
    const view = renderPlayback(
      { channel, latencyProfile: 'balanced' },
    )
    await act(async () => Promise.resolve())

    view.rerender({ channel, latencyProfile: 'smooth' })
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
    const view = renderPlayback({ channel, latencyProfile: 'ultra-low' })
    await act(async () => Promise.resolve())
    act(() => {
      mocks.instances[0].emit('levelUpdated', {
        details: { partTarget: 0.2, targetduration: 4, averagetargetduration: 3.2 },
      })
    })
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(playback.current.diagnostics).toMatchObject({
      targetLatencySeconds: 2.56,
      maxLatencySeconds: 3.36,
      measuredSegmentSeconds: 3.2,
    })

    view.rerender({ channel, latencyProfile: mode })
    await act(async () => Promise.resolve())
    const video = playback.current.videoRef.current!
    video.currentTime = 10
    mocks.instances.at(-1)!.latency = 4
    fireEvent(video, new Event('play'))

    expect(video.currentTime).toBe(10)
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(playback.current.diagnostics).toMatchObject({
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
    expect(playback.current.diagnostics).toMatchObject({
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
    expect(playback.current.diagnostics).toMatchObject({
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
    expect(playback.current.diagnostics).toMatchObject({
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

  it.each(['ultra-low', 'balanced', 'smooth'] as const)(
    'stops HLS playlist loading on explicit pause in %s and restarts on play',
    async (mode) => {
      const video = await renderPlayer(mode)
      const hls = mocks.instances[0]
      Object.defineProperty(video, 'paused', { configurable: true, value: false })
      fireEvent(video, new Event('playing'))

      act(() => playback.current.playerProps.onUserPauseChange(true))
      expect(hls.stopLoad).toHaveBeenCalledOnce()
      await act(async () => vi.advanceTimersByTimeAsync(10_000))
      expect(hls.startLoad).not.toHaveBeenCalled()

      act(() => playback.current.playerProps.onUserPauseChange(false))
      expect(hls.startLoad).toHaveBeenCalledOnce()
    },
  )

  it('does not override an explicit user pause during recovery', async () => {
    const video = await renderPlayer()
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    fireEvent(video, new Event('playing'))
    playback.current.playerProps.onUserPauseChange(true)
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

  it('keeps a replacement HLS provider stopped while the viewer is paused', async () => {
    const { rerender } = renderPlayback({ channel, latencyProfile: 'balanced' })
    await act(async () => Promise.resolve())
    act(() => playback.current.playerProps.onUserPauseChange(true))

    rerender({ channel, latencyProfile: 'smooth' })
    await act(async () => Promise.resolve())

    expect(mocks.instances).toHaveLength(2)
    const replacement = mocks.instances[1]
    expect(replacement.stopLoad).toHaveBeenCalled()
    expect(replacement.startLoad).not.toHaveBeenCalled()

    act(() => playback.current.playerProps.onUserPauseChange(false))
    expect(replacement.startLoad).toHaveBeenCalledOnce()
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

    const latest = playback.current.diagnostics
    expect(latest).toMatchObject({
      correctiveSeekCount: 1,
      forwardBufferBreachCount: 1,
      latencyBreachCount: 1,
      maxObservedForwardBufferSeconds: 3.5,
      maxObservedLatencySeconds: 3.1,
    })
    expect(['forwardBuffer', 'liveLatency']).toContain(
      latest.lastBreachMetric,
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

  it('does not flash reconnecting for a network stall while buffered video can play', async () => {
    mocks.videoAlreadyPlaying = true
    renderPlayback({ channel, latencyProfile: 'balanced' })
    await act(async () => Promise.resolve())
    const video = playback.current.videoRef.current!
    fireEvent(video, new Event('stalled'))
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(playback.current.state).not.toBe('reconnecting')
  })

  it('reports buffering without reconnecting or replacing a healthy HLS connection', async () => {
    mocks.videoAlreadyPlaying = true
    renderPlayback({ channel, latencyProfile: 'balanced' })
    await act(async () => Promise.resolve())
    const video = playback.current.videoRef.current!
    Object.defineProperty(video, 'readyState', { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA })
    fireEvent(video, new Event('waiting'))
    expect(playback.current.state).not.toBe('reconnecting')
    await act(async () => vi.advanceTimersByTimeAsync(100))
    fireEvent(video, new Event('playing'))
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(playback.current.state).not.toBe('reconnecting')
    fireEvent(video, new Event('waiting'))
    await act(async () => vi.advanceTimersByTimeAsync(250))
    expect(playback.current.state).toBe('buffering')
    const playerKey = playback.current.playerKey
    await act(async () => vi.advanceTimersByTimeAsync(1_500))
    expect(playback.current.playerKey).toBe(playerKey)
    fireEvent(video, new Event('playing'))
    expect(playback.current.state).toBe('playing')
  })

  it('reports repeated ultra-low stalls within 30 seconds', async () => {
    const onUltraLowFailure = vi.fn()
    renderPlayback(
      { channel, latencyProfile: 'ultra-low', onUltraLowFailure },
    )
    await act(async () => Promise.resolve())
    const video = playback.current.videoRef.current!
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    fireEvent(video, new Event('playing'))

    fireEvent(video, new Event('waiting'))
    fireEvent(video, new Event('stalled'))
    await act(async () => vi.advanceTimersByTimeAsync(250))
    expect(onUltraLowFailure).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(1_001))
    fireEvent(video, new Event('waiting'))
    await act(async () => vi.advanceTimersByTimeAsync(250))

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
    renderPlayback(
      { channel, latencyProfile: 'balanced', onBalancedUnavailable },
    )
    await act(async () => Promise.resolve())
    const video = playback.current.videoRef.current!
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    fireEvent(video, new Event('playing'))

    await act(async () => vi.advanceTimersByTimeAsync(5_000))

    expect(onBalancedUnavailable).toHaveBeenCalledOnce()
  })
})
