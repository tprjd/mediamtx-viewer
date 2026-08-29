export type StreamState = 'live' | 'offline' | 'unavailable'

export interface ChannelStatus {
  state: StreamState
  live: boolean
  startedAt: string | null
  tracks: string[]
  checkedAt: string
}

export interface PublicChannel {
  slug: string
  displayName: string
  title: string
  description?: string
  poster?: string
  accentColor: string
  preferredPlayback: 'hls' | 'webrtc'
  hasCompatibilityFallback: boolean
  playback: {
    hls: string
    webrtc: string
    fallbackHls?: string
  }
  status: ChannelStatus
}

export interface ChannelsResponse {
  channels: PublicChannel[]
  updatedAt: string
}
