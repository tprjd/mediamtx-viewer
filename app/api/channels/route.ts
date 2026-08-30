import { NextResponse } from 'next/server'

import { getChannels } from '@/lib/channels'
import { getChannelStatuses } from '@/lib/mediamtx'
import { toPublicChannel } from '@/lib/public-channel'
import type { ChannelsResponse } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse<ChannelsResponse>> {
  const configuredChannels = getChannels()
  const statuses = await getChannelStatuses(
    configuredChannels.map((channel) => channel.mediaPath),
  )

  return NextResponse.json(
    {
      channels: configuredChannels.map((channel) =>
        toPublicChannel(channel, statuses.get(channel.mediaPath)!),
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
