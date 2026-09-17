import { NextResponse } from 'next/server'

import { getPublicChannels } from '@/lib/channel-reads'
import type { ChannelsResponse } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse<ChannelsResponse>> {
  const channels = await getPublicChannels()

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
