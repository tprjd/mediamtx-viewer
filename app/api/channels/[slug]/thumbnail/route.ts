import { getActiveSession } from '@/lib/auth/session'
import { canWatchChannel } from '@/lib/viewing-access'
import { readFile, stat } from 'node:fs/promises'

import { getChannel } from '@/lib/channels'
import { channelThumbnailPath } from '@/lib/channel-thumbnails'

export const dynamic = 'force-dynamic'

interface ThumbnailRouteContext {
  params: Promise<{ slug: string }>
}

export async function GET(
  request: Request,
  context: ThumbnailRouteContext,
): Promise<Response> {
  const { slug } = await context.params
  const session = await getActiveSession(request.headers)
  if (!session) return new Response(null, { status: 401 })
  if (!canWatchChannel(session.user.id, slug)) return new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  const channel = getChannel(slug)
  if (!channel) return new Response(null, { status: 404 })

  try {
    const filePath = channelThumbnailPath(channel.mediaPath)
    const [contents, metadata] = await Promise.all([readFile(filePath), stat(filePath)])
    if (!metadata.isFile()) return new Response(null, { status: 404 })

    const etag = `W/"${contents.byteLength}-${Math.trunc(metadata.mtimeMs)}"`
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } })
    }

    return new Response(new Uint8Array(contents), {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Length': String(contents.byteLength),
        'Content-Type': 'image/jpeg',
        ETag: etag,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}
