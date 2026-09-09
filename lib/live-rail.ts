import type { PublicChannel } from '@/lib/types'
import { sortChannelsForHome } from '@/lib/home-dashboard'

export interface LiveRailModel {
  liveChannels: PublicChannel[]
  otherChannels: PublicChannel[]
  watchedSlug: string
}

export function buildLiveRailModel(
  channels: readonly PublicChannel[],
  watchedSlug: string,
): LiveRailModel {
  const sortedChannels = sortChannelsForHome(channels)

  return {
    liveChannels: sortedChannels.filter((channel) => channel.status.live),
    otherChannels: sortedChannels.filter((channel) => !channel.status.live),
    watchedSlug,
  }
}
