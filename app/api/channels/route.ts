import { getActiveSession } from '@/lib/auth/session'
import { NextResponse } from 'next/server'

import { getPublicChannels } from '@/lib/channel-reads'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const session = await getActiveSession()
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const channels = await getPublicChannels(session.user.id)

  return NextResponse.json(
    {
      channels,
      updatedAt: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    },
  )
}
