import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChannelEvents } from '@/hooks/use-channel-events'
import type { ChannelStatusSnapshot, PublicChannel } from '@/lib/types'

class MockEventSource extends EventTarget {
  static instances: MockEventSource[] = []
  readonly url: string
  readyState = 0

  constructor(url: string) {
    super()
    this.url = url
    MockEventSource.instances.push(this)
  }

  close() {
    this.readyState = 2
  }

  emit(type: string, data?: unknown) {
    this.dispatchEvent(
      data === undefined
        ? new Event(type)
        : new MessageEvent(type, { data: JSON.stringify(data) }),
    )
  }
}

const channel: PublicChannel = {
  slug: 'alice',
  ownerName: 'Alice',
  title: 'Alice stream',
  accentColor: '#8b5cf6',
  preferredPlayback: 'webrtc',
  hasCompatibilityFallback: false,
  playback: {
    hls: '/media/hls/channels/alice/index.m3u8',
    webrtc: '/media/whep/channels/alice/whep',
  },
  status: {
    state: 'offline',
    live: false,
    startedAt: null,
    tracks: [],
    viewerCount: 0,
    checkedAt: '2026-08-31T10:00:00.000Z',
  },
}

const snapshot: ChannelStatusSnapshot = {
  channels: [
    {
      slug: 'alice',
      ownerName: 'Alice',
      title: 'Alice stream',
      discordNotificationsEnabled: true,
      poster: '/api/channels/alice/thumbnail?v=456',
      status: {
        state: 'live',
        live: true,
        startedAt: '2026-08-31T10:01:00.000Z',
        tracks: ['AV1', 'Opus'],
        viewerCount: 2,
        checkedAt: '2026-08-31T10:01:02.000Z',
      },
    },
  ],
  updatedAt: '2026-08-31T10:01:02.000Z',
}

function Probe({ initial = [channel] }: { initial?: PublicChannel[] }) {
  const result = useChannelEvents(initial)
  const current = result.channels[0]
  return (
    <div>
      <span>{current?.status.state ?? 'empty'}</span>
      <span>{current?.status.viewerCount}</span>
      <span>{current?.poster ?? 'no poster'}</span>
      <span>{result.statusDelayed ? 'delayed' : 'current'}</span>
      <output data-testid="channels">{JSON.stringify(result.channels)}</output>
    </div>
  )
}

function currentChannels(): PublicChannel[] {
  return JSON.parse(screen.getByTestId('channels').textContent!)
}

async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms))
}

afterEach(() => {
  cleanup()
  MockEventSource.instances = []
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useChannelEvents', () => {
  beforeEach(() => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })

  it('preserves live playback during an unavailable event, including after a heartbeat', () => {
    vi.stubGlobal('EventSource', MockEventSource)
    render(<Probe />)
    const source = MockEventSource.instances[0]!
    act(() => {
      source.emit('snapshot', snapshot)
      source.emit('channel-status', {
        ...snapshot.channels[0],
        status: { ...channel.status, state: 'unavailable', checkedAt: '2026-08-31T10:02:00.000Z' },
      })
      source.emit('heartbeat')
    })
    expect(screen.getByText('live')).toBeInTheDocument()
    expect(screen.getByText('delayed')).toBeInTheDocument()
  })

  it('ignores a late fallback response after newer event data arrives', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', MockEventSource)
    let resolve!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((done) => { resolve = done })))
    render(<Probe />)
    const source = MockEventSource.instances[0]!
    act(() => source.emit('error'))
    await act(async () => vi.advanceTimersByTimeAsync(5_000))
    act(() => source.emit('snapshot', snapshot))
    await act(async () => {
      resolve(Response.json({ channels: [channel], updatedAt: channel.status.checkedAt }))
      await Promise.resolve()
    })
    expect(screen.getByText('live')).toBeInTheDocument()
  })

  it('starts fallback when an open event stream stops sending messages', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', MockEventSource)
    const fetcher = vi.fn().mockResolvedValue(Response.json({ channels: [channel], updatedAt: channel.status.checkedAt }))
    vi.stubGlobal('fetch', fetcher)
    render(<Probe />)
    act(() => MockEventSource.instances[0]!.emit('snapshot', snapshot))
    await act(async () => vi.advanceTimersByTimeAsync(45_000))
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('keeps known status for a partial polling outage and accepts confirmed offline status', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', MockEventSource)
    const live = { ...channel, status: snapshot.channels[0]!.status }
    const other = { ...live, slug: 'bob' }
    const checkedAt = '2026-08-31T10:03:00.000Z'
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      channels: [
        { ...live, status: { ...channel.status, state: 'unavailable', checkedAt } },
        { ...other, status: { ...channel.status, checkedAt } },
      ], updatedAt: checkedAt,
    }))
    vi.stubGlobal('fetch', fetcher)
    render(<Probe initial={[live, other]} />)
    await advance(5_000)
    expect(currentChannels().map((value) => value.status.state)).toEqual(['live', 'offline'])
    expect(screen.getByText('delayed')).toBeInTheDocument()
    act(() => MockEventSource.instances[0]!.emit('channel-status', {
      ...snapshot.channels[0], status: { ...channel.status, checkedAt: '2026-08-31T10:04:00.000Z' },
    }))
    expect(currentChannels()[0]!.status.state).toBe('offline')
    expect(screen.getByText('current')).toBeInTheDocument()
  })

  it('rejects older events even after retaining status from before an outage', () => {
    vi.stubGlobal('EventSource', MockEventSource)
    render(<Probe />)
    const source = MockEventSource.instances[0]!
    act(() => {
      source.emit('snapshot', snapshot)
      source.emit('channel-status', { ...snapshot.channels[0],
        status: { ...channel.status, state: 'unavailable', checkedAt: '2026-08-31T10:04:00.000Z' } })
      source.emit('channel-status', { ...snapshot.channels[0],
        status: { ...channel.status, checkedAt: '2026-08-31T10:03:00.000Z' } })
    })
    expect(screen.getByText('live')).toBeInTheDocument()
    expect(screen.getByText('delayed')).toBeInTheDocument()
  })

  it('updates presentation metadata without changing playback URLs', () => {
    vi.stubGlobal('EventSource', MockEventSource)
    render(<Probe />)
    act(() => MockEventSource.instances[0]!.emit('channel-status', {
      ...snapshot.channels[0], title: 'New title', ownerName: 'New name', poster: null,
    }))
    expect(currentChannels()[0]).toMatchObject({
      title: 'New title', ownerName: 'New name', playback: channel.playback,
    })
    expect(screen.getByText('no poster')).toBeInTheDocument()
  })

  it('loads full data for a new Channel and applies its newer event before publishing', async () => {
    vi.stubGlobal('EventSource', MockEventSource)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      channels: [{ ...channel, slug: 'bob' }], updatedAt: '2026-08-31T10:02:00.000Z',
    })))
    render(<Probe />)
    await act(async () => {
      MockEventSource.instances[0]!.emit('snapshot', {
        channels: [{ ...snapshot.channels[0], slug: 'bob' }], updatedAt: snapshot.updatedAt,
      })
      await Promise.resolve()
    })
    expect(currentChannels().map((value) => value.slug)).toEqual(['bob'])
    expect(currentChannels()[0]!.status.state).toBe('live')
    act(() => MockEventSource.instances[0]!.emit('directory', {
      channels: [], updatedAt: '2026-08-31T10:03:00.000Z',
    }))
    expect(currentChannels()).toEqual([])
  })

  it('does not let an older snapshot remove newer directory entries', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', MockEventSource)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      channels: [channel, { ...channel, slug: 'bob' }], updatedAt: '2026-08-31T10:05:00.000Z',
    })))
    render(<Probe />)
    await advance(5_000)
    act(() => MockEventSource.instances[0]!.emit('snapshot', snapshot))
    expect(currentChannels().map((value) => value.slug)).toEqual(['alice', 'bob'])
  })

  it('does not stop fallback on open or postpone it for repeated errors', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', MockEventSource)
    const fetcher = vi.fn().mockResolvedValue(Response.json({ channels: [channel], updatedAt: channel.status.checkedAt }))
    vi.stubGlobal('fetch', fetcher)
    render(<Probe />)
    const source = MockEventSource.instances[0]!
    act(() => source.emit('open'))
    await advance(4_000)
    act(() => source.emit('error'))
    await advance(1_000)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it.each(['missing', 'throws'])('uses JSON when EventSource is %s', async (failure) => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', failure === 'missing' ? undefined : class {
      constructor() { throw new Error('EventSource unavailable') }
    })
    const fetcher = vi.fn().mockResolvedValue(Response.json({ channels: [channel], updatedAt: channel.status.checkedAt }))
    vi.stubGlobal('fetch', fetcher)
    render(<Probe />)
    await advance(5_000)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(currentChannels()).toEqual([channel])
  })

  it('bounds a hung poll and continues polling without waiting for its promise', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', MockEventSource)
    const fetcher = vi.fn().mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValue(Response.json({ channels: [channel], updatedAt: channel.status.checkedAt }))
    vi.stubGlobal('fetch', fetcher)
    render(<Probe />)
    await advance(10_000)
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    expect(screen.getByText('delayed')).toBeInTheDocument()
    await advance(30_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(screen.getByText('current')).toBeInTheDocument()
  })

  it.each(['hidden', 'offline'])('waits while %s, then refreshes on return', async (condition) => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', MockEventSource)
    if (condition === 'hidden') vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    else vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const fetcher = vi.fn().mockResolvedValue(Response.json({ channels: [channel], updatedAt: channel.status.checkedAt }))
    vi.stubGlobal('fetch', fetcher)
    render(<Probe />)
    await advance(60_000)
    expect(fetcher).not.toHaveBeenCalled()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(MockEventSource.instances).toHaveLength(1)
  })

  it('ignores malformed polling data and keeps the last known state', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', MockEventSource)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ channels: [{}] })))
    render(<Probe />)
    await advance(5_000)
    expect(currentChannels()).toEqual([channel])
    expect(screen.getByText('delayed')).toBeInTheDocument()
  })

  it('ignores callbacks from closed event sources and aborts work on unmount', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', MockEventSource)
    const fetcher = vi.fn().mockReturnValue(new Promise(() => {}))
    vi.stubGlobal('fetch', fetcher)
    const { unmount } = render(<Probe />)
    const oldSource = MockEventSource.instances[0]!
    act(() => window.dispatchEvent(new Event('pageshow')))
    act(() => oldSource.emit('snapshot', snapshot))
    expect(screen.getByText('offline')).toBeInTheDocument()
    await advance(5_000)
    unmount()
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    expect(MockEventSource.instances.every((source) => source.readyState === 2)).toBe(true)
    await advance(60_000)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('applies an SSE snapshot to the server-rendered channel', () => {
    vi.stubGlobal('EventSource', MockEventSource)
    render(<Probe />)
    const source = MockEventSource.instances[0]!

    expect(source.url).toBe('/api/channel-events')
    act(() => {
      source.emit('open')
      source.emit('snapshot', snapshot)
    })

    expect(screen.getByText('live')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(
      screen.getByText('/api/channels/alice/thumbnail?v=456'),
    ).toBeInTheDocument()
    expect(screen.getByText('current')).toBeInTheDocument()
  })

  it('starts slow JSON fallback polling only after SSE stays unhealthy', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', MockEventSource)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        channels: [
          {
            ...channel,
            status: snapshot.channels[0]!.status,
            poster: snapshot.channels[0]!.poster,
          },
        ],
        updatedAt: snapshot.updatedAt,
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    render(<Probe />)

    act(() => MockEventSource.instances[0]!.emit('error'))
    expect(fetcher).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(fetcher).toHaveBeenCalledOnce()
    expect(screen.getByText('live')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
