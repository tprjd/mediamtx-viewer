import 'server-only'

import { isWhipPilotChannel } from '@/lib/whip-pilot'
import { canSeeChannel, canWatchChannel } from '@/lib/viewing-access'
import { getChannel, getChannels } from '@/lib/channels'
import { channelPosterUrl } from '@/lib/channel-thumbnails'
import { getChannelStatus, getChannelStatuses } from '@/lib/mediamtx'
import { toPublicChannel } from '@/lib/public-channel'
import type { ChannelMonitorEvent } from '@/lib/channel-status-monitor'
import type { ChannelLiveUpdate, ChannelStatus, ChannelStatusSnapshot, PublicChannel } from '@/lib/types'

function visibleStatus(status: ChannelStatus, viewingAllowed: boolean): ChannelStatus {
  return viewingAllowed ? status : { ...status, tracks: [], viewerCount: null }
}

function visibleLiveUpdate(viewerId: string, update: ChannelLiveUpdate): ChannelLiveUpdate | null {
  if (!canSeeChannel(viewerId, update.slug)) return null
  const viewingAllowed = canWatchChannel(viewerId, update.slug)
  return {
    ...update,
    viewingAllowed,
    ...(!viewingAllowed && update.playback ? { playback: { hls: '', webrtc: '' } } : {}),
    poster: viewingAllowed ? update.poster : null,
    status: visibleStatus(update.status, viewingAllowed),
  }
}

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
  return (await readChannels(viewerId))
    .filter(({ channel }) => canSeeChannel(viewerId, channel.slug))
    .map(({ channel, status, poster }) => {
      const viewingAllowed = canWatchChannel(viewerId, channel.slug)
      const result = toPublicChannel(channel, visibleStatus(status, viewingAllowed), poster)
      return viewingAllowed ? { ...result, viewingAllowed } : {
        ...result,
        viewingAllowed,
        description: undefined,
        poster: undefined,
        playback: { hls: '', webrtc: '' },
      }
    })
}

export async function getPublicChannelStatus(viewerId: string, slug: string): Promise<ChannelStatus | null> {
  // Preserve the status route's lookup: a disabled Channel is absent, even for its owner.
  const channel = canSeeChannel(viewerId, slug) ? getChannel(slug) : undefined
  if (!channel) return null
  const status = await getChannelStatus(channel.mediaPath)
  return visibleStatus(status, canWatchChannel(viewerId, slug))
}

/** Filter each delivery with current access; never modify the shared monitor event. */
export function getPublicChannelEvent(viewerId: string, event: ChannelMonitorEvent): ChannelMonitorEvent | null {
  if (event.type === 'channel-status') {
    const data = visibleLiveUpdate(viewerId, event.data)
    return data ? { ...event, data } : null
  }
  return {
    ...event,
    data: {
      ...event.data,
      channels: event.data.channels.flatMap((update) => {
        const visible = visibleLiveUpdate(viewerId, update)
        return visible ? [visible] : []
      }),
    },
  }
}

/** Periodic directory events carry full Channel data, unlike monitor updates. */
export async function getPublicChannelDirectory(viewerId: string): Promise<ChannelStatusSnapshot> {
  const channels = await getPublicChannels(viewerId)
  return {
    channels: channels.map((channel) => ({
      ...channel,
      discordNotificationsEnabled: false,
      poster: channel.poster ?? null,
    })),
    updatedAt: new Date().toISOString(),
  }
}

/** Account-neutral data for the shared monitor and internal subscribers. */
export async function loadChannelLiveUpdates(): Promise<ChannelLiveUpdate[]> {
  return (await readChannels()).map(({ channel, status, poster }) => ({
    ...(isWhipPilotChannel(channel.slug) ? toPublicChannel(channel, status, poster) : {}),
    slug: channel.slug,
    ownerName: channel.ownerName,
    title: channel.title,
    discordNotificationsEnabled: channel.discordNotificationsEnabled,
    status,
    poster: poster ?? null,
  }))
}
