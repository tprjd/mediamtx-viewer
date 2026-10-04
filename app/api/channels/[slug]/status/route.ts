import { getActiveSession } from '@/lib/auth/session'
import { canSeeChannel, canWatchChannel } from '@/lib/viewing-access'
import { NextResponse } from 'next/server'

import { getChannel } from '@/lib/channels'
import { getChannelStatus } from '@/lib/mediamtx'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ slug: string }>
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params
  const session = await getActiveSession()
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const channel = canSeeChannel(session.user.id, slug) ? getChannel(slug) : undefined

  if (!channel) {
    return NextResponse.json(
      { error: 'Channel not found' },
      { status: 404 },
    )
  }

  const status = await getChannelStatus(channel.mediaPath)

  return NextResponse.json(
    { status: canWatchChannel(session.user.id, slug) ? status : { ...status, tracks: [], viewerCount: null } },
    {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    },
  )
}
