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
    ).toMatchObject({ state: 'offline', live: false, startedAt: null })
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
    })
  })

  it('does not leak API failures to the caller', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('down'))

    await expect(getChannelStatus('live', fetcher)).resolves.toMatchObject({
      state: 'unavailable',
      live: false,
      tracks: [],
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
