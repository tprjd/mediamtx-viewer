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
): PublicChannel {
  const mediaPath = encodeMediaPath(channel.mediaPath)

  return {
    slug: channel.slug,
    ownerName: channel.ownerName,
    title: channel.title,
    description: channel.description,
    poster,
    accentColor: channel.accentColor,
    preferredPlayback: channel.preferredPlayback,
    hasCompatibilityFallback: Boolean(channel.fallbackMediaPath),
    playback: {
      hls: hlsUrl(channel.mediaPath),
      webrtc: `/media/whep/${mediaPath}/whep`,
      fallbackHls: channel.fallbackMediaPath
        ? hlsUrl(channel.fallbackMediaPath)
        : undefined,
    },
    status,
  }
}
