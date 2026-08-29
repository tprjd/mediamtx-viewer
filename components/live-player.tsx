'use client'

import { useCallback, useState } from 'react'

import { HlsPlayer } from '@/components/hls-player'
import { WebRtcPlayer } from '@/components/webrtc-player'
import type { PublicChannel } from '@/lib/types'

interface LivePlayerProps {
  channel: PublicChannel
}

export function LivePlayer({ channel }: LivePlayerProps) {
  const [protocol, setProtocol] = useState<'webrtc' | 'hls'>(
    channel.preferredPlayback,
  )
  const handleFallback = useCallback(() => setProtocol('hls'), [])

  if (protocol === 'webrtc') {
    return (
      <WebRtcPlayer
        channel={channel}
        onFallback={handleFallback}
      />
    )
  }

  return <HlsPlayer channel={channel} />
}
