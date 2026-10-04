import 'server-only'

import { canSeeChannel, canWatchChannel } from '@/lib/viewing-access'
import { getChannels } from '@/lib/channels'
import { channelPosterUrl } from '@/lib/channel-thumbnails'
import { getChannelStatuses } from '@/lib/mediamtx'
import { toPublicChannel } from '@/lib/public-channel'
import type { ChannelLiveUpdate, PublicChannel } from '@/lib/types'

async function readChannels(viewerId?: string) {
  const channels = getChannels(viewerId)
  const statuses = await getChannelStatuses(
    channels.map((channel) => channel.mediaPath),
  )

  return channels.map((channel) => {
    const status = statuses.get(channel.mediaPath)!
    return { channel, status, poster: channelPosterUrl(channel, status.live) }
  })
}

export async function getPublicChannels(viewerId: string): Promise<PublicChannel[]> {
  return (await readChannels(viewerId)).filter(({ channel }) => canSeeChannel(viewerId, channel.slug)).map(({ channel, status, poster }) => {
    const allowed = canWatchChannel(viewerId, channel.slug)
    const result = toPublicChannel(channel, status, poster)
    return allowed ? { ...result, viewingAllowed: true } : {
      ...result, viewingAllowed: false, description: undefined, poster: undefined,
      playback: { hls: '', webrtc: '' },
      status: { ...status, tracks: [], viewerCount: null },
    }
  })
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
