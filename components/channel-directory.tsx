'use client'

import { useEffect, useState } from 'react'

import { ChannelCard } from '@/components/channel-card'
import type { ChannelsResponse, PublicChannel } from '@/lib/types'

interface ChannelDirectoryProps {
  initialChannels: PublicChannel[]
}

export function ChannelDirectory({ initialChannels }: ChannelDirectoryProps) {
  const [channels, setChannels] = useState(initialChannels)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined

    const poll = async () => {
      if (!active || document.hidden) {
        timer = setTimeout(poll, 5_000)
        return
      }

      controller = new AbortController()
      try {
        const response = await fetch('/api/channels', {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (response.ok) {
          const data = (await response.json()) as ChannelsResponse
          if (active) setChannels(data.channels)
        }
      } finally {
        if (active) timer = setTimeout(poll, 5_000)
      }
    }

    timer = setTimeout(poll, 5_000)

    return () => {
      active = false
      clearTimeout(timer)
      controller?.abort()
    }
  }, [])

  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {channels.map((channel) => (
        <ChannelCard channel={channel} key={channel.slug} />
      ))}
    </div>
  )
}
