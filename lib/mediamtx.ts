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
    readers: z
      .array(
        z.object({
          id: z.string(),
          type: z.string(),
        }),
      )
      .optional(),
  })
  .passthrough()

const mediaMtxPathListSchema = z
  .object({ items: z.array(mediaMtxPathSchema).optional() })
  .passthrough()

const apiOrigin = process.env.MEDIAMTX_API_URL ?? 'http://127.0.0.1:9997'
const thumbnailQueryParameter = 'frankerzspam_internal'
const thumbnailQueryValue = 'thumbnail'
const viewerQueryParameter = 'frankerzspam_viewer'
const viewerIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

const hlsSessionListSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().optional(),
            query: z.string().optional(),
            userAgent: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()

function checkedAt(): string {
  return new Date().toISOString()
}

function hasHlsReaders(
  path: z.infer<typeof mediaMtxPathSchema>,
): boolean {
  return (path.readers ?? []).some((reader) => reader.type === 'hlsSession')
}

function hasWebRtcReaders(
  path: z.infer<typeof mediaMtxPathSchema>,
): boolean {
  return (path.readers ?? []).some((reader) => reader.type === 'webRTCSession')
}

function isThumbnailSession(
  query: string | undefined,
  userAgent: string | undefined,
): boolean {
  return (
    userAgent === 'FrankerzSpamThumbnailer/1.0' ||
    (Boolean(query) &&
      new URLSearchParams(query).get(thumbnailQueryParameter) ===
        thumbnailQueryValue)
  )
}

function readViewerId(query: string | undefined): string | undefined {
  if (!query) return undefined
  const viewerId = new URLSearchParams(query).get(viewerQueryParameter)
  return viewerId && viewerIdPattern.test(viewerId) ? viewerId : undefined
}

interface HlsReaderMetadata {
  thumbnailReaderIds: Set<string>
  viewerIds: Map<string, string>
}

function emptyHlsReaderMetadata(): HlsReaderMetadata {
  return {
    thumbnailReaderIds: new Set(),
    viewerIds: new Map(),
  }
}

async function getHlsReaderMetadata(
  fetcher: typeof fetch,
): Promise<HlsReaderMetadata | null> {
  try {
    const response = await fetcher(`${apiOrigin}/v3/hlssessions/list`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    })
    if (!response.ok) return null
    const data = hlsSessionListSchema.parse(await response.json())
    const thumbnailReaderIds = new Set<string>()
    const viewerIds = new Map<string, string>()
    for (const session of data.items ?? []) {
      if (!session.id) continue
      if (isThumbnailSession(session.query, session.userAgent)) {
        thumbnailReaderIds.add(session.id)
        continue
      }
      const viewerId = readViewerId(session.query)
      if (viewerId) viewerIds.set(session.id, viewerId)
    }
    return { thumbnailReaderIds, viewerIds }
  } catch {
    return null
  }
}

async function getWebRtcViewerIds(
  fetcher: typeof fetch,
): Promise<Map<string, string>> {
  try {
    const response = await fetcher(`${apiOrigin}/v3/webrtcsessions/list`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    })
    if (!response.ok) return new Map()
    const data = hlsSessionListSchema.parse(await response.json())
    return new Map(
      (data.items ?? []).flatMap((session) => {
        const viewerId = readViewerId(session.query)
        return session.id && viewerId ? [[session.id, viewerId]] : []
      }),
    )
  } catch {
    return new Map()
  }
}

function mergeViewerIds(
  ...maps: ReadonlyMap<string, string>[]
): Map<string, string> {
  return new Map(maps.flatMap((map) => [...map]))
}

export function normalizeMediaMtxPath(
  data: unknown,
  thumbnailReaderIds: ReadonlySet<string> | null = new Set(),
  readerViewerIds: ReadonlyMap<string, string> = new Map(),
): ChannelStatus {
  const path = mediaMtxPathSchema.parse(data)
  const live = path.ready ?? path.available ?? path.online ?? false
  const viewerCount = !live
    ? 0
    : !path.readers || (hasHlsReaders(path) && thumbnailReaderIds === null)
      ? null
      : new Set(
          path.readers
            .filter(
              (reader) =>
                reader.type !== 'hidden' &&
                !thumbnailReaderIds?.has(reader.id),
            )
            .map((reader) =>
              readerViewerIds.has(reader.id)
                ? `viewer:${readerViewerIds.get(reader.id)}`
                : `reader:${reader.id}`,
            ),
        ).size

  return {
    state: live ? 'live' : 'offline',
    live,
    startedAt:
      path.readyTime ?? path.availableTime ?? path.onlineTime ?? null,
    tracks: [...new Set(path.tracks ?? [])],
    viewerCount,
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
        viewerCount: 0,
        checkedAt: checkedAt(),
      }
    }

    if (!response.ok) {
      throw new Error(`MediaMTX returned HTTP ${response.status}`)
    }

    const path = mediaMtxPathSchema.parse(await response.json())
    const hlsMetadata = hasHlsReaders(path)
      ? await getHlsReaderMetadata(fetcher)
      : emptyHlsReaderMetadata()
    const webRtcViewerIds = hasWebRtcReaders(path)
      ? await getWebRtcViewerIds(fetcher)
      : new Map<string, string>()
    return normalizeMediaMtxPath(
      path,
      hlsMetadata?.thumbnailReaderIds ?? null,
      mergeViewerIds(hlsMetadata?.viewerIds ?? new Map(), webRtcViewerIds),
    )
  } catch {
    return {
      state: 'unavailable',
      live: false,
      startedAt: null,
      tracks: [],
      viewerCount: null,
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
    viewerCount: null,
    checkedAt: checkedAt(),
  }
}

function offlineStatus(): ChannelStatus {
  return {
    state: 'offline',
    live: false,
    startedAt: null,
    tracks: [],
    viewerCount: 0,
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
    const paths = data.items ?? []
    const hlsMetadata = paths.some(hasHlsReaders)
      ? await getHlsReaderMetadata(fetcher)
      : emptyHlsReaderMetadata()
    const webRtcViewerIds = paths.some(hasWebRtcReaders)
      ? await getWebRtcViewerIds(fetcher)
      : new Map<string, string>()
    const readerViewerIds = mergeViewerIds(
      hlsMetadata?.viewerIds ?? new Map(),
      webRtcViewerIds,
    )
    const active = new Map(
      paths
        .filter((item): item is typeof item & { name: string } => Boolean(item.name))
        .map((item) => [
          item.name,
          normalizeMediaMtxPath(
            item,
            hlsMetadata?.thumbnailReaderIds ?? null,
            readerViewerIds,
          ),
        ]),
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
