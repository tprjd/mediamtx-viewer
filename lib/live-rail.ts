import type { PublicChannel } from '@/lib/types'

export interface LiveRailModel {
  liveChannels: PublicChannel[]
  watchedSlug: string
}

export function buildLiveRailModel(
  channels: readonly PublicChannel[],
  watchedSlug: string,
): LiveRailModel {
  return {
    liveChannels: channels
      .filter((channel) => channel.status.live)
      .sort((a, b) => {
        const aViewers = a.status.viewerCount ?? 0
        const bViewers = b.status.viewerCount ?? 0
        if (aViewers !== bViewers) return bViewers - aViewers
        return a.title.localeCompare(b.title)
      }),
    watchedSlug,
  }
}
