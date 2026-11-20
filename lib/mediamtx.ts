import 'server-only'

import { z } from 'zod'

import { countViewers, isRelaySource, isThumbnailSession, readViewerId } from '@/lib/media-readers'
import { getOnlineRelay, getRelayViewerIds, disconnectRelayViewers } from '@/lib/relay-broker'
import { hlsDerivativePath } from '@/lib/whip-pilot'
import type { ChannelStatus } from '@/lib/types'

const mediaMtxPathSchema = z
  .object({
    name: z.string().optional(),
    ready: z.boolean().optional(),
    source: z.object({ type: z.string(), id: z.string() }).nullish(),
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

const rtmpSessionSchema = z
  .object({
    id: z.string().optional(),
    path: z.string().optional(),
    state: z.string().optional(),
    query: z.string().optional(),
  })
  .passthrough()

const rtmpSessionListSchema = z
  .object({ items: z.array(rtmpSessionSchema).optional() })
  .passthrough()

const RTMP_SESSION_LIST_ENDPOINTS = [
  { list: '/v3/rtmpconns/list', kick: '/v3/rtmpconns/kick/' },
  { list: '/v3/rtmpsconns/list', kick: '/v3/rtmpsconns/kick/' },
]

const readerSessionListSchema = z
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

interface ReaderMetadata {
  internalReaderIds: Set<string>
  viewerIds: Map<string, string>
}

function emptyReaderMetadata(): ReaderMetadata {
  return {
    internalReaderIds: new Set(),
    viewerIds: new Map(),
  }
}

async function getReaderMetadata(
  protocol: 'hls' | 'webrtc',
  fetcher: typeof fetch,
): Promise<ReaderMetadata | null> {
  try {
    const response = await fetcher(`${apiOrigin}/v3/${protocol}sessions/list`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    })
    if (!response.ok) return null
    const data = readerSessionListSchema.parse(await response.json())
    const internalReaderIds = new Set<string>()
    const viewerIds = new Map<string, string>()
    for (const session of data.items ?? []) {
      if (!session.id) continue
      if (protocol === 'hls' ? isThumbnailSession(session.query, session.userAgent) : isRelaySource(session.query)) {
        internalReaderIds.add(session.id)
        continue
      }
      const viewerId = readViewerId(session.query)
      if (viewerId) viewerIds.set(session.id, viewerId)
    }
    return { internalReaderIds, viewerIds }
  } catch {
    return null
  }
}

async function readAudienceMetadata(hls: boolean, webRtc: boolean, fetcher: typeof fetch) {
  const [hlsSessions, webRtcSessions] = await Promise.all([
    hls ? getReaderMetadata('hls', fetcher) : emptyReaderMetadata(),
    webRtc ? getReaderMetadata('webrtc', fetcher) : emptyReaderMetadata(),
  ])
  const internalIds = new Set([...(hlsSessions?.internalReaderIds ?? []), ...(webRtcSessions?.internalReaderIds ?? [])])
  const viewerIds = new Map([...(hlsSessions?.viewerIds ?? []), ...(webRtcSessions?.viewerIds ?? [])])
  return (path: z.infer<typeof mediaMtxPathSchema>, mediaPath: string) => {
    const incomplete = (!hlsSessions && hasHlsReaders(path)) ||
      (!webRtcSessions && hasWebRtcReaders(path) && getOnlineRelay(mediaPath))
    return normalizeMediaMtxPath(path, incomplete ? null : internalIds, viewerIds, getRelayViewerIds(mediaPath))
  }
}

export function normalizeMediaMtxPath(
  data: unknown,
  internalReaderIds: ReadonlySet<string> | null = new Set(),
  readerViewerIds: ReadonlyMap<string, string> = new Map(),
  relayViewerIds: readonly string[] = [],
): ChannelStatus {
  const path = mediaMtxPathSchema.parse(data)
  const live = path.ready ?? path.available ?? path.online ?? false
  const viewerCount = !live
    ? 0
    : !path.readers || internalReaderIds === null
      ? null
      : countViewers(path.readers, internalReaderIds, readerViewerIds, relayViewerIds)

  return {
    ...(path.source ? { publisherProtocol: path.source.type === 'webRTCSession' ? 'whip' as const : 'other' as const } : {}),
    ...(hlsDerivativePath(path) ? { hlsMediaPath: hlsDerivativePath(path) } : {}),
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

    let path = mediaMtxPathSchema.parse(await response.json())
    const derivative = hlsDerivativePath(path)
    if (derivative) {
      try {
        const fallback = await fetcher(`${apiOrigin}/v3/paths/get/${derivative}`, { cache: 'no-store', signal: AbortSignal.timeout(2500) })
        if (fallback.ok) path = combineReaders(path, mediaMtxPathSchema.parse(await fallback.json()))
      } catch { /* Fallback failure must not make the original Publisher offline. */ }
    }
    const withAudience = await readAudienceMetadata(hasHlsReaders(path), hasWebRtcReaders(path), fetcher)
    return withAudience(path, mediaPath)
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
    const withAudience = await readAudienceMetadata(paths.some(hasHlsReaders), paths.some(hasWebRtcReaders), fetcher)
    const active = new Map(
      paths
        .filter((item): item is typeof item & { name: string } => Boolean(item.name))
        .map((item) => [
          item.name,
          withAudience(
            combineReaders(item, paths.find(candidate => candidate.name === hlsDerivativePath(item))),
            item.name,
          ),
        ]),
    )
    return new Map(mediaPaths.map((path) => [path, active.get(path) ?? offlineStatus()]))
  } catch {
    return new Map(mediaPaths.map((path) => [path, unavailableStatus()]))
  }
}

interface WebRtcSessionList {
  pageCount?: number
  items: Array<{
    id?: string
    path?: string
    state?: 'read' | 'publish'
    query?: string
  }>
}

export async function disconnectAllWebRtcReaders(
  fetcher: typeof fetch = fetch,
): Promise<number> {
  return disconnectWebRtcSessions({}, fetcher)
}

export async function disconnectChannelReaders(mediaPath: string, fetcher: typeof fetch = fetch): Promise<number> {
  return disconnectWebRtcSessions({ mediaPath, state: 'read' }, fetcher)
}

export async function disconnectRelaySource(mediaPath: string, generation: string, fetcher: typeof fetch = fetch): Promise<number> {
  return disconnectWebRtcSessions({ mediaPath, state: 'read', relayGeneration: generation }, fetcher)
}

export async function disconnectChannelSessions(
  mediaPath: string,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  disconnectRelayViewers(undefined, mediaPath)
  return disconnectWebRtcSessions({ mediaPath }, fetcher)
}

export async function disconnectChannelPublisher(
  mediaPath: string,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const webrtcKicked = await disconnectWebRtcSessions(
    { mediaPath, state: 'publish' },
    fetcher,
  )
  const rtmpKicked = await disconnectRtmpPublishers(mediaPath, fetcher)
  return webrtcKicked + rtmpKicked
}

async function kickRtmpPublishersOnEndpoint(
  endpoint: { list: string; kick: string },
  mediaPath: string,
  fetcher: typeof fetch,
): Promise<number> {
  const response = await fetcher(`${apiOrigin}${endpoint.list}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(2500),
  })
  if (!response.ok) throw new Error(`MediaMTX returned HTTP ${response.status}`)

  const data: z.infer<typeof rtmpSessionListSchema> = rtmpSessionListSchema.parse(
    await response.json(),
  )
  const ids = (data.items ?? [])
    .filter((session) => session.path === mediaPath && session.state === 'publish')
    .map((session) => session.id)
    .filter((id): id is string => Boolean(id))

  await Promise.all(
    ids.map(async (id) => {
      const kick = await fetcher(
        `${apiOrigin}${endpoint.kick}${encodeURIComponent(id)}`,
        { method: 'POST', signal: AbortSignal.timeout(2500) },
      )
      if (!kick.ok && kick.status !== 404) {
        throw new Error(`MediaMTX returned HTTP ${kick.status}`)
      }
    }),
  )
  return ids.length
}

export async function disconnectRtmpPublishers(
  mediaPath: string,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const kicked = await Promise.all(
    RTMP_SESSION_LIST_ENDPOINTS.map((endpoint) =>
      kickRtmpPublishersOnEndpoint(endpoint, mediaPath, fetcher),
    ),
  )
  return kicked.reduce((sum, count) => sum + count, 0)
}

async function disconnectWebRtcSessions(
  filter: { mediaPath?: string; state?: 'read' | 'publish'; relayGeneration?: string },
  fetcher: typeof fetch,
): Promise<number> {
  const sessions: WebRtcSessionList['items'] = []
  let pageCount = 1
  for (let page = 0; page < pageCount; page++) {
    const url = new URL('/v3/webrtcsessions/list', apiOrigin)
    if (page) url.searchParams.set('page', String(page))
    const response = await fetcher(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(2500) })
    if (!response.ok) throw new Error(`MediaMTX returned HTTP ${response.status}`)
    const data = (await response.json()) as WebRtcSessionList
    sessions.push(...data.items)
    if (page === 0) pageCount = data.pageCount ?? 1
  }
  const ids = sessions
    .filter(
      (session) =>
        (!filter.mediaPath || session.path === filter.mediaPath) &&
        (!filter.state || session.state === filter.state) &&
        (!filter.relayGeneration || (isRelaySource(session.query) && new URLSearchParams(session.query).get('relay_generation') === filter.relayGeneration)) &&
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

function combineReaders(source: z.infer<typeof mediaMtxPathSchema>, derivative?: z.infer<typeof mediaMtxPathSchema>) {
  if (!source.ready || !derivative?.ready) return source
  return { ...source, readers: [...(source.readers ?? []), ...(derivative.readers ?? [])] }
}
