import { NextResponse } from 'next/server'

import { getChannels } from '@/lib/channels'
import { getChannelStatus } from '@/lib/mediamtx'
import { toPublicChannel } from '@/lib/public-channel'
import type { ChannelsResponse } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse<ChannelsResponse>> {
  const configuredChannels = getChannels()
  const statuses = await Promise.all(
    configuredChannels.map((channel) => getChannelStatus(channel.mediaPath)),
  )

  return NextResponse.json(
    {
      channels: configuredChannels.map((channel, index) =>
        toPublicChannel(channel, statuses[index]),
      ),
      updatedAt: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    },
  )
}
