import 'server-only'

import { statSync } from 'node:fs'
import path from 'node:path'

import type { Channel } from '@/lib/channel-schema'

const thumbnailRoot =
  process.env.THUMBNAIL_DIR ?? path.join(process.cwd(), '.data', 'thumbnails')

export function thumbnailFileName(mediaPath: string): string {
  return `${encodeURIComponent(mediaPath)}.jpg`
}

export function channelThumbnailPath(
  mediaPath: string,
  root = thumbnailRoot,
): string {
  return path.join(root, thumbnailFileName(mediaPath))
}

export function channelThumbnailUrl(
  channel: Pick<Channel, 'slug' | 'mediaPath'>,
  root = thumbnailRoot,
): string | undefined {
  try {
    const metadata = statSync(channelThumbnailPath(channel.mediaPath, root))
    if (!metadata.isFile()) return undefined
    return `/api/channels/${encodeURIComponent(channel.slug)}/thumbnail?v=${Math.trunc(metadata.mtimeMs)}`
  } catch {
    return undefined
  }
}

export function channelPosterUrl(
  channel: Pick<Channel, 'slug' | 'mediaPath' | 'poster'>,
  live: boolean,
  root = thumbnailRoot,
): string | undefined {
  if (channel.poster) return channel.poster
  return live ? channelThumbnailUrl(channel, root) : undefined
}
