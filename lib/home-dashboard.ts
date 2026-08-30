import type { PublicChannel } from '@/lib/types'

export interface HomeDashboardModel {
  featuredChannel: PublicChannel | null
  remainingLiveChannels: PublicChannel[]
  allChannels: PublicChannel[]
  liveCount: number
  statusUnavailable: boolean
}

export function buildHomeDashboardModel(
  channels: readonly PublicChannel[],
): HomeDashboardModel {
  const liveChannels = channels.filter((channel) => channel.status.live)
  const liveSlugs = new Set(liveChannels.map((channel) => channel.slug))

  return {
    featuredChannel: liveChannels[0] ?? null,
    remainingLiveChannels: liveChannels.slice(1),
    allChannels: [
      ...liveChannels,
      ...channels.filter((channel) => !liveSlugs.has(channel.slug)),
    ],
    liveCount: liveChannels.length,
    statusUnavailable:
      channels.length > 0 &&
      channels.every((channel) => channel.status.state === 'unavailable'),
  }
}

export function newlyLiveChannelNames(
  previous: readonly PublicChannel[],
  next: readonly PublicChannel[],
): string[] {
  const previousStates = new Map(
    previous.map((channel) => [channel.slug, channel.status.live]),
  )
  return next
    .filter(
      (channel) =>
        channel.status.live && previousStates.get(channel.slug) !== true,
    )
    .map((channel) => channel.displayName)
}

export function mergeChannelsWithLastStatus(
  previous: readonly PublicChannel[],
  incoming: readonly PublicChannel[],
): PublicChannel[] {
  const previousChannels = new Map(
    previous.map((channel) => [channel.slug, channel]),
  )
  return incoming.map((channel) => {
    const previousChannel = previousChannels.get(channel.slug)
    return previousChannel && previousChannel.status.state !== 'unavailable'
      ? { ...channel, status: previousChannel.status }
      : channel
  })
}
