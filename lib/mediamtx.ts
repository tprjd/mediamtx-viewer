import 'server-only'

import { z } from 'zod'

import type { ChannelStatus } from '@/lib/types'

const mediaMtxPathSchema = z
  .object({
    name: z.string().optional(),
    ready: z.boolean().optional(),
    available: z.boolean().optional(),
    online: z.boolean().optional(),
    readyTime: z.string().nullish(),
    availableTime: z.string().nullish(),
    onlineTime: z.string().nullish(),
    tracks: z.array(z.string()).optional(),
  })
  .passthrough()

const mediaMtxPathListSchema = z
  .object({ items: z.array(mediaMtxPathSchema).optional() })
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

function unavailableStatus(): ChannelStatus {
  return {
    state: 'unavailable',
    live: false,
    startedAt: null,
    tracks: [],
    checkedAt: checkedAt(),
  }
}

function offlineStatus(): ChannelStatus {
  return {
    state: 'offline',
    live: false,
    startedAt: null,
    tracks: [],
    checkedAt: checkedAt(),
  }
}

export async function getChannelStatuses(
  mediaPaths: readonly string[],
  fetcher: typeof fetch = fetch,
): Promise<Map<string, ChannelStatus>> {
  if (mediaPaths.length === 0) return new Map()
  try {
    const response = await fetcher(`${apiOrigin}/v3/paths/list`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    })
    if (!response.ok) throw new Error(`MediaMTX returned HTTP ${response.status}`)
    const data = mediaMtxPathListSchema.parse(await response.json())
    const active = new Map(
      (data.items ?? [])
        .filter((item): item is typeof item & { name: string } => Boolean(item.name))
        .map((item) => [item.name, normalizeMediaMtxPath(item)]),
    )
    return new Map(mediaPaths.map((path) => [path, active.get(path) ?? offlineStatus()]))
  } catch {
    return new Map(mediaPaths.map((path) => [path, unavailableStatus()]))
  }
}

interface WebRtcSessionList {
  items?: Array<{
    id?: string
    path?: string
    state?: 'read' | 'publish'
  }>
}

export async function disconnectAllWebRtcReaders(
  fetcher: typeof fetch = fetch,
): Promise<number> {
  return disconnectWebRtcSessions({}, fetcher)
}

export async function disconnectChannelSessions(
  mediaPath: string,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  return disconnectWebRtcSessions({ mediaPath }, fetcher)
}

export async function disconnectChannelPublisher(
  mediaPath: string,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  return disconnectWebRtcSessions({ mediaPath, state: 'publish' }, fetcher)
}

async function disconnectWebRtcSessions(
  filter: { mediaPath?: string; state?: 'read' | 'publish' },
  fetcher: typeof fetch,
): Promise<number> {
  const response = await fetcher(`${apiOrigin}/v3/webrtcsessions/list`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(2500),
  })
  if (!response.ok) throw new Error(`MediaMTX returned HTTP ${response.status}`)

  const data = (await response.json()) as WebRtcSessionList
  const ids = (data.items ?? [])
    .filter(
      (session) =>
        (!filter.mediaPath || session.path === filter.mediaPath) &&
        (!filter.state || session.state === filter.state) &&
        (filter.mediaPath || session.state !== 'publish'),
    )
    .map((session) => session.id)
    .filter((id): id is string => Boolean(id))

  await Promise.all(
    ids.map(async (id) => {
      const kick = await fetcher(
        `${apiOrigin}/v3/webrtcsessions/kick/${encodeURIComponent(id)}`,
        { method: 'POST', signal: AbortSignal.timeout(2500) },
      )
      if (!kick.ok && kick.status !== 404) {
        throw new Error(`MediaMTX returned HTTP ${kick.status}`)
      }
    }),
  )
  return ids.length
}
