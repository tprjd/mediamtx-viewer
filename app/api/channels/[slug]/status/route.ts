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
  const channel = getChannel(slug)

  if (!channel) {
    return NextResponse.json(
      { error: 'Channel not found' },
      { status: 404 },
    )
  }

  const status = await getChannelStatus(channel.mediaPath)

  return NextResponse.json(
    { status },
    {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    },
  )
}
