import 'server-only'

import { getChannels } from '@/lib/channels'
import { channelPosterUrl } from '@/lib/channel-thumbnails'
import { getChannelStatuses } from '@/lib/mediamtx'
import { toPublicChannel } from '@/lib/public-channel'
import type { ChannelLiveUpdate, PublicChannel } from '@/lib/types'

async function readChannels() {
  const channels = getChannels()
  const statuses = await getChannelStatuses(
    channels.map((channel) => channel.mediaPath),
  )

  return channels.map((channel) => {
    const status = statuses.get(channel.mediaPath)!
    return { channel, status, poster: channelPosterUrl(channel, status.live) }
  })
}

export async function getPublicChannels(): Promise<PublicChannel[]> {
  return (await readChannels()).map(({ channel, status, poster }) =>
    toPublicChannel(channel, status, poster),
  )
}

export async function loadChannelLiveUpdates(): Promise<ChannelLiveUpdate[]> {
  return (await readChannels()).map(({ channel, status, poster }) => ({
    slug: channel.slug,
    ownerName: channel.ownerName,
    title: channel.title,
    discordNotificationsEnabled: channel.discordNotificationsEnabled,
    status,
    poster: poster ?? null,
  }))
}
