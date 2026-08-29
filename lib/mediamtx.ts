import 'server-only'

import { z } from 'zod'

import type { ChannelStatus } from '@/lib/types'

const mediaMtxPathSchema = z
  .object({
    ready: z.boolean().optional(),
    available: z.boolean().optional(),
    online: z.boolean().optional(),
    readyTime: z.string().optional(),
    availableTime: z.string().optional(),
    onlineTime: z.string().optional(),
    tracks: z.array(z.string()).optional(),
  })
  .passthrough()

const apiOrigin = process.env.MEDIAMTX_API_URL ?? 'http://127.0.0.1:9997'

function checkedAt(): string {
  return new Date().toISOString()
}

export function normalizeMediaMtxPath(data: unknown): ChannelStatus {
  const path = mediaMtxPathSchema.parse(data)
  const live = path.ready ?? path.available ?? path.online ?? false

  return {
    state: live ? 'live' : 'offline',
    live,
    startedAt:
      path.readyTime ?? path.availableTime ?? path.onlineTime ?? null,
    tracks: [...new Set(path.tracks ?? [])],
    checkedAt: checkedAt(),
  }
}

export async function getChannelStatus(
  mediaPath: string,
  fetcher: typeof fetch = fetch,
): Promise<ChannelStatus> {
  const encodedPath = mediaPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')

  try {
    const response = await fetcher(`${apiOrigin}/v3/paths/get/${encodedPath}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    })

    if (response.status === 404) {
      return {
        state: 'offline',
        live: false,
        startedAt: null,
        tracks: [],
        checkedAt: checkedAt(),
      }
    }

    if (!response.ok) {
      throw new Error(`MediaMTX returned HTTP ${response.status}`)
    }

    return normalizeMediaMtxPath(await response.json())
  } catch {
    return {
      state: 'unavailable',
      live: false,
      startedAt: null,
      tracks: [],
      checkedAt: checkedAt(),
    }
  }
}
