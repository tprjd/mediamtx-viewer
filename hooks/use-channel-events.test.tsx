import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

function Probe() {
  const result = useChannelEvents([channel])
  const current = result.channels[0]!
  return (
    <div>
      <span>{current.status.state}</span>
      <span>{current.status.viewerCount}</span>
      <span>{current.poster ?? 'no poster'}</span>
      <span>{result.statusDelayed ? 'delayed' : 'current'}</span>
    </div>
  )
}

afterEach(() => {
  cleanup()
  MockEventSource.instances = []
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useChannelEvents', () => {
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
