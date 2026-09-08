import type { PublicChannel } from '@/lib/types'

export interface HomeDashboardModel {
  allChannels: PublicChannel[]
  liveCount: number
  statusUnavailable: boolean
}

export function sortChannelsForHome(
  channels: readonly PublicChannel[],
): PublicChannel[] {
  return [...channels].sort((a, b) => {
    const aLive = a.status.live ? 1 : 0
    const bLive = b.status.live ? 1 : 0
    if (aLive !== bLive) return bLive - aLive

    const aViewers = a.status.viewerCount ?? 0
    const bViewers = b.status.viewerCount ?? 0
    if (aViewers !== bViewers) return bViewers - aViewers

    return a.title.localeCompare(b.title)
  })
}

export function buildHomeDashboardModel(
  channels: readonly PublicChannel[],
): HomeDashboardModel {
  const liveChannels = channels.filter((channel) => channel.status.live)

  return {
    allChannels: sortChannelsForHome(channels),
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
    .map((channel) => channel.title)
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
