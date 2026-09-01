import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WebRtcPlayer } from '@/components/webrtc-player'
import type { PublicChannel } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}))

vi.mock('@/components/playback-stats', () => ({
  PlaybackStats: () => null,
}))

vi.mock('@/lib/auth/client', () => ({
  authClient: { getSession: mocks.getSession },
}))

interface FakeReaderOptions {
  onError?: (error: string) => void
  onTrack?: (event: RTCTrackEvent) => void
}

class FakeReader {
  static instances: FakeReader[] = []
  readonly options: FakeReaderOptions
  readonly close = vi.fn()

  constructor(options: FakeReaderOptions) {
    this.options = options
    FakeReader.instances.push(this)
  }
}

const channel: PublicChannel = {
  slug: 'live',
  ownerName: 'David',
  title: 'Late-night games',
  accentColor: '#8b5cf6',
  preferredPlayback: 'webrtc',
  hasCompatibilityFallback: true,
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

function peerWithFrames(getFrames: () => number): RTCPeerConnection {
  return {
    getStats: vi.fn(async () =>
      new Map([
        [
          'video',
          { type: 'inbound-rtp', kind: 'video', framesDecoded: getFrames() },
        ],
      ]),
    ),
  } as unknown as RTCPeerConnection
}

function connect(reader: FakeReader, peer: RTCPeerConnection) {
  const video = screen.getByLabelText('Late-night games live video')
  Object.defineProperty(video, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
  const stream = {
    getAudioTracks: () => [{ kind: 'audio' }],
    getVideoTracks: () => [{ kind: 'video' }],
  } as unknown as MediaStream
  reader.options.onTrack?.({
    currentTarget: peer,
    streams: [stream],
    track: { kind: 'video' },
  } as unknown as RTCTrackEvent)

  Object.defineProperty(video, 'paused', { configurable: true, value: false })
  Object.defineProperty(video, 'ended', { configurable: true, value: false })
  fireEvent(video, new Event('playing'))
  return video
}

async function renderPlayer(onFallback: () => void) {
  render(<WebRtcPlayer channel={channel} onFallback={onFallback} />)
  await Promise.resolve()
  await Promise.resolve()
}

describe('WebRtcPlayer watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    mocks.getSession.mockResolvedValue({ data: { user: { id: 'user' } } })
    FakeReader.instances = []
    window.MediaMTXWebRTCReader = FakeReader as never
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete window.MediaMTXWebRTCReader
  })

  it('keeps the connection when inbound decoded frames advance', async () => {
    let frames = 0
    const fallback = vi.fn()
    await renderPlayer(fallback)
    const peer = peerWithFrames(() => frames)
    connect(FakeReader.instances[0], peer)

    for (let sample = 0; sample < 6; sample += 1) {
      frames += 10
      await vi.advanceTimersByTimeAsync(1_000)
    }

    expect(FakeReader.instances).toHaveLength(1)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('rebuilds once after five stagnant samples and falls back on the next stall', async () => {
    const fallback = vi.fn()
    const peer = peerWithFrames(() => 10)
    await renderPlayer(fallback)
    connect(FakeReader.instances[0], peer)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(FakeReader.instances).toHaveLength(2)
    expect(FakeReader.instances[0].close).not.toHaveBeenCalled()

    connect(FakeReader.instances[1], peer)
    expect(FakeReader.instances[0].close).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(fallback).toHaveBeenCalledOnce()
    expect(FakeReader.instances[1].close).toHaveBeenCalledOnce()
  })

  it('resets the recovery budget after 60 seconds of advancing frames', async () => {
    let frames = 10
    const fallback = vi.fn()
    const peer = peerWithFrames(() => frames)
    render(<WebRtcPlayer channel={channel} onFallback={fallback} />)
    await Promise.resolve()
    await Promise.resolve()
    connect(FakeReader.instances[0], peer)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(FakeReader.instances).toHaveLength(2)

    connect(FakeReader.instances[1], peer)
    for (let sample = 0; sample < 62; sample += 1) {
      frames += 10
      await vi.advanceTimersByTimeAsync(1_000)
    }

    await vi.advanceTimersByTimeAsync(5_000)

    expect(FakeReader.instances).toHaveLength(3)
    expect(FakeReader.instances[1].close).not.toHaveBeenCalled()
    connect(FakeReader.instances[2], peer)
    expect(FakeReader.instances[1].close).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('resets stagnant samples while the document is hidden', async () => {
    const fallback = vi.fn()
    const peer = peerWithFrames(() => 10)
    await renderPlayer(fallback)
    connect(FakeReader.instances[0], peer)
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(FakeReader.instances).toHaveLength(1)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    fireEvent(document, new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(4_000)
    expect(FakeReader.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(FakeReader.instances).toHaveLength(2)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('uses totalVideoFrames when peer stats have no inbound video frame count', async () => {
    const fallback = vi.fn()
    const peer = {
      getStats: vi.fn(async () =>
        new Map([['video', { type: 'inbound-rtp', kind: 'video' }]]),
      ),
    } as unknown as RTCPeerConnection
    await renderPlayer(fallback)
    const video = connect(FakeReader.instances[0], peer)
    Object.defineProperty(video, 'getVideoPlaybackQuality', {
      configurable: true,
      value: () => ({ totalVideoFrames: 10 }),
    })
    await vi.advanceTimersByTimeAsync(5_000)

    expect(FakeReader.instances).toHaveLength(2)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('keeps playing when totalVideoFrames advances without RTC decoded frames', async () => {
    let totalVideoFrames = 10
    const fallback = vi.fn()
    const peer = {
      getStats: vi.fn(async () =>
        new Map([['video', { type: 'inbound-rtp', kind: 'video' }]]),
      ),
    } as unknown as RTCPeerConnection
    render(<WebRtcPlayer channel={channel} onFallback={fallback} />)
    await Promise.resolve()
    await Promise.resolve()
    const video = connect(FakeReader.instances[0], peer)
    Object.defineProperty(video, 'getVideoPlaybackQuality', {
      configurable: true,
      value: () => ({ totalVideoFrames }),
    })

    for (let sample = 0; sample < 6; sample += 1) {
      totalVideoFrames += 10
      await vi.advanceTimersByTimeAsync(1_000)
    }

    expect(FakeReader.instances).toHaveLength(1)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('shows an expired session after a reader error without a session', async () => {
    const fallback = vi.fn()
    await renderPlayer(fallback)
    mocks.getSession.mockResolvedValueOnce({ data: null })
    await act(async () => {
      FakeReader.instances[0].options.onError?.('unauthorized')
      await Promise.resolve()
    })

    expect(screen.getByText('Session expired')).toBeInTheDocument()
    expect(FakeReader.instances[0].close).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('repairs one reader error before falling back to smooth playback', async () => {
    const fallback = vi.fn()
    await renderPlayer(fallback)

    await act(async () => {
      FakeReader.instances[0].options.onError?.('peer connection closed')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(FakeReader.instances).toHaveLength(2)
    expect(fallback).not.toHaveBeenCalled()

    await act(async () => {
      FakeReader.instances[1].options.onError?.('peer connection closed')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('cleans up the reader and watchdog timers on unmount', async () => {
    const fallback = vi.fn()
    const rendered = render(
      <WebRtcPlayer channel={channel} onFallback={fallback} />,
    )
    await Promise.resolve()
    await Promise.resolve()
    const peer = peerWithFrames(() => 10)
    connect(FakeReader.instances[0], peer)
    rendered.unmount()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(FakeReader.instances[0].close).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
  })
})
