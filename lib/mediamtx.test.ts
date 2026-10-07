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
  it('kicks publishers on the requested path across WebRTC, RTMP, and RTMPS', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/webrtcsessions/list')) {
        return Response.json({
          items: [
            { id: 'webrtc-publisher-a', path: 'channels/alice', state: 'publish' },
            { id: 'webrtc-reader-a', path: 'channels/alice', state: 'read' },
            { id: 'webrtc-publisher-b', path: 'channels/bob', state: 'publish' },
          ],
        })
      }
      if (url.endsWith('/rtmpconns/list')) {
        return Response.json({
          items: [
            { id: 'rtmp-publisher-a', path: 'channels/alice', state: 'publish' },
            { id: 'rtmp-reader-b', path: 'channels/bob', state: 'read' },
          ],
        })
      }
      if (url.endsWith('/rtmpsconns/list')) {
        return Response.json({
          items: [
            { id: 'rtmps-publisher-a', path: 'channels/alice', state: 'publish' },
            { id: 'rtmps-reader-b', path: 'channels/alice', state: 'read' },
          ],
        })
      }
      return new Response(null, { status: 200 })
    })

    await expect(disconnectChannelPublisher('channels/alice', fetcher)).resolves.toBe(3)
    const urls = fetcher.mock.calls.map((call) => String(call[0]))
    const includes = (fragment: string) => urls.some((url) => url.includes(fragment))
    expect(includes('/v3/webrtcsessions/list')).toBe(true)
    expect(includes('/v3/webrtcsessions/kick/webrtc-publisher-a')).toBe(true)
    expect(includes('/v3/rtmpconns/list')).toBe(true)
    expect(includes('/v3/rtmpconns/kick/rtmp-publisher-a')).toBe(true)
    expect(includes('/v3/rtmpsconns/list')).toBe(true)
    expect(includes('/v3/rtmpsconns/kick/rtmps-publisher-a')).toBe(true)
  })
})

it('combines canonical and derivative readers without counting the audio worker', async () => {
  const viewer = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const canonical = { name: 'channels/pilot', ready: true, readyTime: '2026-10-07T12:00:00Z', source: { type: 'webRTCSession', id: 'source-1' }, tracks: ['H264', 'Opus'], readers: [{ id: 'worker', type: 'rtspSession' }, { id: 'rtc', type: 'webRTCSession' }] }
  const derivative = { name: '_hls/channels/pilot/source-1', ready: true, tracks: ['H264', 'MPEG-4 Audio'], readers: [{ id: 'hls', type: 'hlsSession' }] }
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const address = String(url)
    if (address.includes('/paths/list')) return Response.json({ items: [canonical, derivative] })
    if (address.includes('/paths/get/_hls/')) return Response.json(derivative)
    if (address.includes('/paths/get/')) return Response.json(canonical)
    if (address.includes('/webrtcsessions/')) return Response.json({ items: [{ id: 'rtc', query: `frankerzspam_viewer=${viewer}` }] })
    if (address.includes('/hlssessions/')) return Response.json({ items: [{ id: 'hls', query: `frankerzspam_viewer=${viewer}` }] })
    return Response.json({ items: [{ id: 'worker', user: 'hls-worker' }] })
  })
  for (const status of [await getChannelStatus('channels/pilot', fetcher), (await getChannelStatuses(['channels/pilot'], fetcher)).get('channels/pilot')]) {
    expect(status).toMatchObject({ viewerCount: 1, tracks: ['H264', 'Opus'], startedAt: '2026-10-07T12:00:00Z', hlsMediaPath: '_hls/channels/pilot/source-1', publisherProtocol: 'whip' })
  }
})

it('keeps original WebRTC media live when derivative status fails', async () => {
  const fetcher = vi.fn<typeof fetch>(async url => {
    if (String(url).includes('/paths/get/_hls/')) throw new Error('Derivative timeout')
    return Response.json({ name: 'channels/pilot', ready: true, tracks: ['H264', 'Opus'], source: { type: 'webRTCSession', id: 'source-1' }, readers: [] })
  })
  expect(await getChannelStatus('channels/pilot', fetcher)).toMatchObject({ live: true, tracks: ['H264', 'Opus'] })
})
