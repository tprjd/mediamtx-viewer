import type {
  ChannelLiveUpdate,
  ChannelStatus,
  ChannelStatusSnapshot,
  ChannelsResponse,
  PublicChannel,
} from '@/lib/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isChannelStatus(status: unknown): status is ChannelStatus {
  if (!isRecord(status)) return false
  return (
    (status.state === 'live' || status.state === 'offline' || status.state === 'unavailable') &&
    status.live === (status.state === 'live') &&
    (status.startedAt === null || isTimestamp(status.startedAt)) &&
    Array.isArray(status.tracks) && status.tracks.every((track) => typeof track === 'string') &&
    (status.viewerCount === null || (typeof status.viewerCount === 'number' &&
      Number.isInteger(status.viewerCount) && status.viewerCount >= 0)) &&
    isTimestamp(status.checkedAt)
  )
}

export function isChannelLiveUpdate(value: unknown): value is ChannelLiveUpdate {
  if (!isRecord(value) || typeof value.slug !== 'string') return false
  if (typeof value.ownerName !== 'string') return false
  if (typeof value.title !== 'string') return false
  if (typeof value.discordNotificationsEnabled !== 'boolean') return false
  if (value.poster !== null && typeof value.poster !== 'string') return false
  return isChannelStatus(value.status)
}

export function isChannelStatusSnapshot(
  value: unknown,
): value is ChannelStatusSnapshot {
  return (
    isRecord(value) &&
    Array.isArray(value.channels) &&
    value.channels.every(isChannelLiveUpdate) &&
    isTimestamp(value.updatedAt)
  )
}

function isPublicChannel(value: unknown): value is PublicChannel {
  if (!isRecord(value) || !isRecord(value.playback)) return false
  return typeof value.slug === 'string' && typeof value.title === 'string' &&
    typeof value.ownerName === 'string' && typeof value.accentColor === 'string' &&
    (value.description === undefined || typeof value.description === 'string') &&
    (value.poster === undefined || typeof value.poster === 'string') &&
    (value.preferredPlayback === 'hls' || value.preferredPlayback === 'webrtc') &&
    typeof value.hasCompatibilityFallback === 'boolean' &&
    typeof value.playback.hls === 'string' && typeof value.playback.webrtc === 'string' &&
    (value.playback.fallbackHls === undefined || typeof value.playback.fallbackHls === 'string') &&
    isChannelStatus(value.status)
}

export function isChannelsResponse(value: unknown): value is ChannelsResponse {
  return isRecord(value) && Array.isArray(value.channels) &&
    value.channels.every(isPublicChannel) && isTimestamp(value.updatedAt)
}
