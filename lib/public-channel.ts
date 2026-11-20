import { isWhipPilotChannel } from '@/lib/whip-pilot'
import { isWebRtcAvailable } from '@/lib/playback-availability'

import type { Channel } from '@/lib/channel-schema'
import type { ChannelStatus, PublicChannel } from '@/lib/types'

function encodeMediaPath(path: string): string {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function hlsUrl(path: string): string {
  return `/media/hls/${encodeMediaPath(path)}/index.m3u8?cookieCheck=1`
}

export function toPublicChannel(
  channel: Channel,
  status: ChannelStatus,
  poster = channel.poster,
  relay?: 'online' | 'online-hls' | 'offline',
): PublicChannel {
  const mediaPath = encodeMediaPath(channel.mediaPath)
  let preferredPlayback = channel.preferredPlayback
  if (relay === 'offline') preferredPlayback = 'hls'
  else if (status.live && isWebRtcAvailable(status.tracks) &&
    (relay === 'online' || relay === 'online-hls' || (isWhipPilotChannel(channel.slug) && status.publisherProtocol === 'whip'))) {
    preferredPlayback = 'webrtc'
  }

  return {
    slug: channel.slug,
    ownerName: channel.ownerName,
    title: channel.title,
    description: channel.description,
    poster,
    accentColor: channel.accentColor,
    preferredPlayback,
    hasCompatibilityFallback: Boolean(channel.fallbackMediaPath),
    playback: {
      hls: hlsUrl(isWhipPilotChannel(channel.slug) && status.hlsMediaPath ? status.hlsMediaPath : channel.mediaPath),
      webrtc: relay ? `/api/channels/${channel.slug}/relay/whep` : `/media/whep/${mediaPath}/whep`,
      ...(relay === 'online-hls' && status.live ? { relayHls: `/api/channels/${encodeURIComponent(channel.slug)}/relay/hls` } : {}),
      fallbackHls: channel.fallbackMediaPath
        ? hlsUrl(channel.fallbackMediaPath)
        : undefined,
    },
    status,
  }
}
