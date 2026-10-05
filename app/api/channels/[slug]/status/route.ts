import { getActiveSession } from '@/lib/auth/session'
import { NextResponse } from 'next/server'

import { getPublicChannelStatus } from '@/lib/channel-reads'

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
  const status = await getPublicChannelStatus(session.user.id, slug)

  if (!status) {
    return NextResponse.json(
      { error: 'Channel not found' },
      { status: 404 },
    )
  }

  return NextResponse.json(
    { status },
    {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    },
  )
}
