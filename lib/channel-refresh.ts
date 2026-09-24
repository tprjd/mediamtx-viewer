import { isChannelLiveUpdate, isChannelStatusSnapshot, isChannelsResponse } from '@/lib/channel-events'
import type { ChannelLiveUpdate, PublicChannel } from '@/lib/types'

const STALE_AFTER_MS = 45_000
const FALLBACK_AFTER_MS = 5_000
const POLL_INTERVAL_MS = 30_000
const REQUEST_TIMEOUT_MS = 5_000

export interface ChannelRefreshState {
  channels: PublicChannel[]
  statusDelayed: boolean
}

/** Owns one Channel subscription, including event/poll ordering and recovery. */
export function startChannelRefresh(
  initial: PublicChannel[],
  onChange: (state: ChannelRefreshState) => void,
): () => void {
  let channels = initial
  let active = true
  let transportDelayed = false
  let fallback = false
  let source: EventSource | undefined
  let staleTimer: ReturnType<typeof setTimeout> | undefined
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let requestTimer: ReturnType<typeof setTimeout> | undefined
  let pending: AbortController | undefined
  let directoryVersion = Math.max(0, ...initial.map((channel) => Date.parse(channel.status.checkedAt)))
  const observedAt = new Map(initial.map((channel) => [channel.slug, Date.parse(channel.status.checkedAt)]))
  const unavailable = new Set(initial.filter((channel) => channel.status.state === 'unavailable').map((channel) => channel.slug))
  const unknownUpdates = new Map<string, ChannelLiveUpdate>()

  const eligible = () => active && !document.hidden && navigator.onLine !== false
  const publish = () => {
    if (active) onChange({ channels, statusDelayed: transportDelayed || unavailable.size > 0 })
  }

  const merge = (previous: PublicChannel, update: PublicChannel | ChannelLiveUpdate): PublicChannel => {
    const timestamp = Date.parse(update.status.checkedAt)
    if (timestamp < (observedAt.get(update.slug) ?? 0)) return previous
    observedAt.set(update.slug, timestamp)
    if (update.status.state === 'unavailable') unavailable.add(update.slug)
    else unavailable.delete(update.slug)
    return {
      ...previous,
      ...('playback' in update ? update : { title: update.title, ownerName: update.ownerName }),
      poster: update.poster ?? undefined,
      status: update.status.state === 'unavailable' && previous.status.state !== 'unavailable'
        ? previous.status : update.status,
    }
  }

  const cancelPoll = () => {
    const controller = pending
    pending = undefined
    clearTimeout(requestTimer)
    clearTimeout(pollTimer)
    controller?.abort()
  }

  const schedulePoll = (delay = POLL_INTERVAL_MS) => {
    clearTimeout(pollTimer)
    if (active && (fallback || unknownUpdates.size > 0)) {
      pollTimer = setTimeout(() => void poll(), delay)
    }
  }

  const poll = async () => {
    if (!eligible() || pending) {
      schedulePoll()
      return
    }
    const controller = new AbortController()
    pending = controller
    requestTimer = setTimeout(() => {
      if (pending !== controller) return
      pending = undefined
      controller.abort()
      transportDelayed = true
      publish()
      schedulePoll()
    }, REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch('/api/channels', { cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error('Channel status request failed')
      const data: unknown = await response.json()
      if (!active || pending !== controller) return
      if (!isChannelsResponse(data)) throw new Error('Invalid Channel response')
      if (Date.parse(data.updatedAt) < directoryVersion) return
      directoryVersion = Date.parse(data.updatedAt)
      const previous = new Map(channels.map((channel) => [channel.slug, channel]))
      channels = data.channels.map((channel) => {
        let merged = merge(previous.get(channel.slug) ?? channel, channel)
        const update = unknownUpdates.get(channel.slug)
        if (update) merged = merge(merged, update)
        return merged
      })
      const slugs = new Set(channels.map((channel) => channel.slug))
      for (const slug of observedAt.keys()) if (!slugs.has(slug)) observedAt.delete(slug)
      for (const slug of unavailable) if (!slugs.has(slug)) unavailable.delete(slug)
      for (const slug of slugs) unknownUpdates.delete(slug)
      transportDelayed = false
      publish()
    } catch {
      if (active && pending === controller) {
        transportDelayed = true
        publish()
      }
    } finally {
      if (pending === controller) {
        pending = undefined
        clearTimeout(requestTimer)
        schedulePoll()
      }
    }
  }

  const startFallback = () => {
    if (!active || fallback) return
    fallback = true
    void poll()
  }

  const expectActivity = () => {
    clearTimeout(staleTimer)
    staleTimer = setTimeout(() => {
      transportDelayed = true
      publish()
      startFallback()
      // An open connection can stop delivering events without an error.
      if (eligible()) connect()
    }, STALE_AFTER_MS)
  }

  const acceptEvents = (updates: ChannelLiveUpdate[], snapshotAt?: string) => {
    if (snapshotAt && Date.parse(snapshotAt) < directoryVersion) return
    fallback = false
    clearTimeout(fallbackTimer)
    fallbackTimer = undefined
    cancelPoll()
    if (snapshotAt) {
      directoryVersion = Date.parse(snapshotAt)
      const slugs = new Set(updates.map((update) => update.slug))
      channels = channels.filter((channel) => slugs.has(channel.slug))
      for (const slug of unavailable) if (!slugs.has(slug)) unavailable.delete(slug)
      for (const slug of observedAt.keys()) if (!slugs.has(slug)) observedAt.delete(slug)
      for (const slug of unknownUpdates.keys()) if (!slugs.has(slug)) unknownUpdates.delete(slug)
    }
    const known = new Set(channels.map((channel) => channel.slug))
    for (const update of updates) {
      if (!known.has(update.slug)) {
        const previous = unknownUpdates.get(update.slug)
        if (!previous || Date.parse(update.status.checkedAt) >= Date.parse(previous.status.checkedAt)) {
          unknownUpdates.set(update.slug, update)
        }
      }
    }
    const bySlug = new Map(updates.map((update) => [update.slug, update]))
    channels = channels.map((channel) => {
      const update = bySlug.get(channel.slug)
      return update ? merge(channel, update) : channel
    })
    transportDelayed = false
    publish()
    expectActivity()
    if (unknownUpdates.size > 0) void poll()
  }

  const awaitFallback = () => {
    if (fallbackTimer !== undefined || fallback) return
    fallbackTimer = setTimeout(() => {
      fallbackTimer = undefined
      startFallback()
    }, FALLBACK_AFTER_MS)
  }

  const connect = () => {
    source?.close()
    source = undefined
    if (!eligible()) return
    expectActivity()
    awaitFallback()
    if (typeof EventSource !== 'function') return
    let connection: EventSource
    try {
      connection = new EventSource('/api/channel-events')
    } catch {
      // Keep the scheduled JSON fallback when the browser cannot open SSE.
      return
    }
    source = connection
    const current = () => active && source === connection
    const parse = (event: Event): unknown => {
      try { return JSON.parse((event as MessageEvent<string>).data) } catch { return null }
    }
    const receiveSnapshot = (event: Event) => {
      if (!current()) return
      const data = parse(event)
      if (isChannelStatusSnapshot(data)) acceptEvents(data.channels, data.updatedAt)
    }
    connection.addEventListener('snapshot', receiveSnapshot)
    connection.addEventListener('directory', receiveSnapshot)
    connection.addEventListener('channel-status', (event) => {
      if (!current()) return
      const data = parse(event)
      if (isChannelLiveUpdate(data)) acceptEvents([data])
    })
    connection.addEventListener('heartbeat', () => {
      if (!current()) return
      // A heartbeat proves transport activity, not that status data is available.
      expectActivity()
    })
    connection.addEventListener('error', () => {
      if (current()) awaitFallback()
    })
  }

  const resume = () => {
    if (!eligible()) {
      cancelPoll()
      return
    }
    connect()
    if (fallback || unknownUpdates.size > 0) void poll()
    expectActivity()
  }
  document.addEventListener('visibilitychange', resume)
  window.addEventListener('online', resume)
  window.addEventListener('offline', resume)
  window.addEventListener('pageshow', resume)
  expectActivity()
  connect()

  return () => {
    active = false
    source?.close()
    source = undefined
    cancelPoll()
    clearTimeout(fallbackTimer)
    clearTimeout(staleTimer)
    document.removeEventListener('visibilitychange', resume)
    window.removeEventListener('online', resume)
    window.removeEventListener('offline', resume)
    window.removeEventListener('pageshow', resume)
  }
}
