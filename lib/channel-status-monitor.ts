import 'server-only'

import { getChannels } from '@/lib/channels'
import { channelPosterUrl } from '@/lib/channel-thumbnails'
import { getChannelStatuses } from '@/lib/mediamtx'
import type {
  ChannelLiveUpdate,
  ChannelStatus,
  ChannelStatusSnapshot,
} from '@/lib/types'

const DEFAULT_POLL_INTERVAL_MS = 2_000
const MAX_RETRY_MS = 30_000
const UNAVAILABLE_THRESHOLD = 2

export type ChannelMonitorEvent =
  | {
      id: number
      type: 'snapshot'
      data: ChannelStatusSnapshot
    }
  | {
      id: number
      type: 'channel-status'
      data: ChannelLiveUpdate
    }

export type ChannelMonitorListener = (event: ChannelMonitorEvent) => void
export type LoadChannelUpdates = () => Promise<ChannelLiveUpdate[]>

interface ChannelStatusMonitorOptions {
  loadUpdates?: LoadChannelUpdates
  pollIntervalMs?: number
  maximumRetryMs?: number
}

function unavailableStatus(): ChannelStatus {
  return {
    state: 'unavailable',
    live: false,
    startedAt: null,
    tracks: [],
    viewerCount: null,
    checkedAt: new Date().toISOString(),
  }
}

function withoutGeneratedPoster(update: ChannelLiveUpdate): ChannelLiveUpdate {
  const generatedPrefix = `/api/channels/${encodeURIComponent(update.slug)}/thumbnail`
  return {
    ...update,
    poster: update.poster?.startsWith(generatedPrefix) ? null : update.poster,
    status: unavailableStatus(),
  }
}

export function sameChannelLiveState(
  first: ChannelLiveUpdate,
  second: ChannelLiveUpdate,
): boolean {
  return (
    first.slug === second.slug &&
    first.poster === second.poster &&
    first.status.state === second.status.state &&
    first.status.live === second.status.live &&
    first.status.startedAt === second.status.startedAt &&
    first.status.viewerCount === second.status.viewerCount &&
    first.status.tracks.length === second.status.tracks.length &&
    first.status.tracks.every(
      (track, index) => track === second.status.tracks[index],
    )
  )
}

export async function loadChannelLiveUpdates(): Promise<ChannelLiveUpdate[]> {
  const channels = getChannels()
  const statuses = await getChannelStatuses(
    channels.map((channel) => channel.mediaPath),
  )

  return channels.map((channel) => {
    const status = statuses.get(channel.mediaPath)!
    return {
      slug: channel.slug,
      status,
      poster: channelPosterUrl(channel, status.live) ?? null,
    }
  })
}

export class ChannelStatusMonitor {
  private readonly loadUpdates: LoadChannelUpdates
  private readonly pollIntervalMs: number
  private readonly maximumRetryMs: number
  private readonly subscribers = new Set<ChannelMonitorListener>()
  private latest = new Map<string, ChannelLiveUpdate>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private refreshPromise: Promise<void> | undefined
  private initialized = false
  private failures = 0
  private eventId = 0

  constructor(options: ChannelStatusMonitorOptions = {}) {
    this.loadUpdates = options.loadUpdates ?? loadChannelLiveUpdates
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.maximumRetryMs = options.maximumRetryMs ?? MAX_RETRY_MS
  }

  async subscribe(listener: ChannelMonitorListener): Promise<() => void> {
    if (!this.initialized || this.subscribers.size === 0) await this.refresh()
    this.subscribers.add(listener)
    this.emitTo(listener, {
      id: this.nextEventId(),
      type: 'snapshot',
      data: this.snapshot(),
    })
    this.schedule()

    return () => {
      this.subscribers.delete(listener)
      if (this.subscribers.size === 0) this.stopTimer()
    }
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = undefined
    })
    return this.refreshPromise
  }

  private async performRefresh(): Promise<void> {
    try {
      const updates = await this.loadUpdates()
      const allUnavailable =
        updates.length > 0 &&
        updates.every((update) => update.status.state === 'unavailable')

      if (allUnavailable) {
        this.failures += 1
        if (this.failures === 1) {
          console.warn('MediaMTX status monitor is temporarily unavailable')
        }
        if (this.initialized && this.failures < UNAVAILABLE_THRESHOLD) return
      } else if (this.failures > 0) {
        console.info('MediaMTX status monitor recovered')
        this.failures = 0
      }

      this.applyUpdates(updates)
      this.initialized = true
    } catch (error) {
      this.failures += 1
      if (this.failures === 1) {
        console.warn(
          `MediaMTX status monitor failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        )
      }
      if (this.failures >= UNAVAILABLE_THRESHOLD && this.latest.size > 0) {
        this.applyUpdates([...this.latest.values()].map(withoutGeneratedPoster))
      }
      this.initialized = true
    }
  }

  private applyUpdates(updates: readonly ChannelLiveUpdate[]): void {
    const previous = this.latest
    this.latest = new Map(updates.map((update) => [update.slug, update]))

    if (!this.initialized) return
    for (const update of updates) {
      const existing = previous.get(update.slug)
      if (!existing || !sameChannelLiveState(existing, update)) {
        if (existing && existing.status.state !== update.status.state) {
          console.info(
            `Channel ${update.slug} changed from ${existing.status.state} to ${update.status.state}`,
          )
        }
        this.broadcast({
          id: this.nextEventId(),
          type: 'channel-status',
          data: update,
        })
      }
    }
  }

  private snapshot(): ChannelStatusSnapshot {
    return {
      channels: [...this.latest.values()],
      updatedAt: new Date().toISOString(),
    }
  }

  private nextEventId(): number {
    this.eventId += 1
    return this.eventId
  }

  private emitTo(
    listener: ChannelMonitorListener,
    event: ChannelMonitorEvent,
  ): void {
    try {
      listener(event)
    } catch {
      this.subscribers.delete(listener)
    }
  }

  private broadcast(event: ChannelMonitorEvent): void {
    for (const listener of this.subscribers) this.emitTo(listener, event)
  }

  private schedule(): void {
    if (this.timer || this.subscribers.size === 0) return
    const delay = Math.min(
      this.pollIntervalMs * 2 ** Math.max(0, this.failures - 1),
      this.maximumRetryMs,
    )
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.refresh().finally(() => this.schedule())
    }, delay)
    this.timer.unref?.()
  }

  private stopTimer(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }
}

const monitorGlobal = globalThis as typeof globalThis & {
  frankerzSpamChannelStatusMonitor?: ChannelStatusMonitor
}

export function getChannelStatusMonitor(): ChannelStatusMonitor {
  monitorGlobal.frankerzSpamChannelStatusMonitor ??= new ChannelStatusMonitor()
  return monitorGlobal.frankerzSpamChannelStatusMonitor
}
