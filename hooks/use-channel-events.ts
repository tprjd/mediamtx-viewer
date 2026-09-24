'use client'

import { useEffect, useState } from 'react'

import { startChannelRefresh, type ChannelRefreshState } from '@/lib/channel-refresh'
import type { PublicChannel } from '@/lib/types'

export function useChannelEvents(initialChannels: PublicChannel[]): ChannelRefreshState {
  const [initial] = useState(initialChannels)
  const [state, setState] = useState<ChannelRefreshState>({
    channels: initial,
    statusDelayed: initial.some((channel) => channel.status.state === 'unavailable'),
  })

  useEffect(() => startChannelRefresh(initial, setState), [initial])

  return state
}
