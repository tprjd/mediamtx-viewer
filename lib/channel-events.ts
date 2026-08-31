import type {
  ChannelLiveUpdate,
  ChannelStatusSnapshot,
  PublicChannel,
} from '@/lib/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isChannelLiveUpdate(value: unknown): value is ChannelLiveUpdate {
  if (!isRecord(value) || typeof value.slug !== 'string') return false
  if (value.poster !== null && typeof value.poster !== 'string') return false
  if (!isRecord(value.status)) return false
  const status = value.status
  return (
    (status.state === 'live' ||
      status.state === 'offline' ||
      status.state === 'unavailable') &&
    typeof status.live === 'boolean' &&
    (status.startedAt === null || typeof status.startedAt === 'string') &&
    Array.isArray(status.tracks) &&
    status.tracks.every((track) => typeof track === 'string') &&
    (status.viewerCount === null ||
      (typeof status.viewerCount === 'number' &&
        Number.isInteger(status.viewerCount) &&
        status.viewerCount >= 0)) &&
    typeof status.checkedAt === 'string'
  )
}

export function isChannelStatusSnapshot(
  value: unknown,
): value is ChannelStatusSnapshot {
  return (
    isRecord(value) &&
    Array.isArray(value.channels) &&
    value.channels.every(isChannelLiveUpdate) &&
    typeof value.updatedAt === 'string'
  )
}

export function mergeChannelLiveUpdates(
  channels: readonly PublicChannel[],
  updates: readonly ChannelLiveUpdate[],
): PublicChannel[] {
  const bySlug = new Map(updates.map((update) => [update.slug, update]))
  return channels.map((channel) => {
    const update = bySlug.get(channel.slug)
    return update
      ? {
          ...channel,
          poster: update.poster ?? undefined,
          status: update.status,
        }
      : channel
  })
}
