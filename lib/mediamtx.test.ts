import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  disconnectChannelPublisher,
  getChannelStatus,
  getChannelStatuses,
  normalizeMediaMtxPath,
} from '@/lib/mediamtx'

describe('normalizeMediaMtxPath', () => {
  it('normalizes the current MediaMTX path schema', () => {
    const status = normalizeMediaMtxPath({
      name: 'live',
      ready: true,
      readyTime: '2026-08-27T20:00:00Z',
      tracks: ['AV1', 'AV1', 'MPEG-4 Audio'],
    })

    expect(status).toMatchObject({
      state: 'live',
      live: true,
      startedAt: '2026-08-27T20:00:00Z',
      tracks: ['AV1', 'MPEG-4 Audio'],
      viewerCount: null,
    })
  })

  it('accepts null timestamps for a configured offline path', () => {
    expect(
      normalizeMediaMtxPath({
        name: 'live',
        ready: false,
        readyTime: null,
        available: false,
        availableTime: null,
        online: false,
        onlineTime: null,
        tracks: [],
      }),
    ).toMatchObject({
      state: 'offline',
      live: false,
      startedAt: null,
      viewerCount: 0,
    })
  })

  it('counts public readers while excluding hidden and thumbnail sessions', () => {
    expect(
      normalizeMediaMtxPath(
        {
          name: 'live',
          ready: true,
          readers: [
            { id: 'viewer-webrtc', type: 'webRTCSession' },
            { id: 'viewer-hls', type: 'hlsSession' },
            { id: 'thumbnail', type: 'hlsSession' },
            { id: 'internal', type: 'hidden' },
          ],
        },
        new Set(['thumbnail']),
      ),
    ).toMatchObject({ viewerCount: 2 })
  })
})

describe('getChannelStatus', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('maps a missing path to offline', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 404 }),
    )

    await expect(getChannelStatus('missing', fetcher)).resolves.toMatchObject({
      state: 'offline',
      live: false,
      viewerCount: 0,
    })
  })

  it('does not leak API failures to the caller', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('down'))

    await expect(getChannelStatus('live', fetcher)).resolves.toMatchObject({
      state: 'unavailable',
      live: false,
      tracks: [],
      viewerCount: null,
    })
  })
})

describe('getChannelStatuses', () => {
  it('maps one path-list request to live and offline channels', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        items: [
          {
            name: 'channels/alice',
            ready: true,
            readyTime: '2026-08-30T10:00:00Z',
            tracks: ['H264', 'Opus'],
          },
        ],
      }),
    )

    const statuses = await getChannelStatuses(
      ['channels/alice', 'channels/bob'],
      fetcher,
    )
    expect(statuses.get('channels/alice')).toMatchObject({ live: true })
    expect(statuses.get('channels/bob')).toMatchObject({ state: 'offline' })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('cross-references HLS sessions to exclude thumbnail readers', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/v3/paths/list')) {
        return Response.json({
          items: [
            {
              name: 'channels/alice',
              ready: true,
              readers: [
                { id: 'hls-viewer', type: 'hlsSession' },
                { id: 'thumbnail', type: 'hlsSession' },
                { id: 'webrtc-viewer', type: 'webRTCSession' },
              ],
            },
          ],
        })
      }
      if (url.endsWith('/v3/hlssessions/list')) {
        return Response.json({
          items: [
            { id: 'hls-viewer', query: 'cookieCheck=1' },
            {
              id: 'thumbnail',
              query: 'frankerzspam_internal=thumbnail',
            },
          ],
        })
      }
      return new Response(null, { status: 404 })
    })

    const statuses = await getChannelStatuses(['channels/alice'], fetcher)

    expect(statuses.get('channels/alice')).toMatchObject({
      live: true,
      viewerCount: 2,
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('counts reconnecting HLS sessions from one player only once', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/v3/paths/list')) {
        return Response.json({
          items: [
            {
              name: 'channels/alice',
              ready: true,
              readers: [
                { id: 'hls-before-reconnect', type: 'hlsSession' },
                { id: 'hls-after-reconnect', type: 'hlsSession' },
              ],
            },
          ],
        })
      }
      if (url.endsWith('/v3/hlssessions/list')) {
        return Response.json({
          items: [
            {
              id: 'hls-before-reconnect',
              query: 'frankerzspam_viewer=018f47a7-1902-7a5b-8d31-bbb8788eb001',
            },
            {
              id: 'hls-after-reconnect',
              query: 'frankerzspam_viewer=018f47a7-1902-7a5b-8d31-bbb8788eb001',
            },
          ],
        })
      }
      return new Response(null, { status: 404 })
    })

    const statuses = await getChannelStatuses(['channels/alice'], fetcher)

    expect(statuses.get('channels/alice')?.viewerCount).toBe(1)
  })

  it('counts one player only once while it changes transports', async () => {
    const viewerId = '018f47a7-1902-7a5b-8d31-bbb8788eb001'
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/v3/paths/list')) {
        return Response.json({
          items: [
            {
              name: 'channels/alice',
              ready: true,
              readers: [
                { id: 'hls-reader', type: 'hlsSession' },
                { id: 'webrtc-reader', type: 'webRTCSession' },
              ],
            },
          ],
        })
      }
      if (url.endsWith('/v3/hlssessions/list')) {
        return Response.json({
          items: [
            {
              id: 'hls-reader',
              query: `frankerzspam_viewer=${viewerId}`,
            },
          ],
        })
      }
      if (url.endsWith('/v3/webrtcsessions/list')) {
        return Response.json({
          items: [
            {
              id: 'webrtc-reader',
              query: `frankerzspam_viewer=${viewerId}`,
            },
          ],
        })
      }
      return new Response(null, { status: 404 })
    })

    const statuses = await getChannelStatuses(['channels/alice'], fetcher)

    expect(statuses.get('channels/alice')?.viewerCount).toBe(1)
  })

  it('uses an unknown count when HLS sessions cannot be classified', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith('/v3/paths/list')
        ? Response.json({
            items: [
              {
                name: 'channels/alice',
                ready: true,
                readers: [{ id: 'hls-viewer', type: 'hlsSession' }],
              },
            ],
          })
        : new Response(null, { status: 503 }),
    )

    const statuses = await getChannelStatuses(['channels/alice'], fetcher)

    expect(statuses.get('channels/alice')?.viewerCount).toBeNull()
  })
})

describe('disconnectChannelPublisher', () => {
  it('kicks only the publisher on the requested path', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/list')) {
        return Response.json({
          items: [
            { id: 'publisher-a', path: 'channels/alice', state: 'publish' },
            { id: 'reader-a', path: 'channels/alice', state: 'read' },
            { id: 'publisher-b', path: 'channels/bob', state: 'publish' },
          ],
        })
      }
      return new Response(null, { status: 200 })
    })

    await expect(disconnectChannelPublisher('channels/alice', fetcher)).resolves.toBe(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('/kick/publisher-a')
  })
})
