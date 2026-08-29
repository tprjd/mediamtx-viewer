import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { getChannelStatus, normalizeMediaMtxPath } from '@/lib/mediamtx'

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
