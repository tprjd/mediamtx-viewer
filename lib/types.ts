export type StreamState = 'live' | 'offline' | 'unavailable'

export interface ChannelStatus {
  publisherProtocol?: 'whip' | 'other'
  hlsMediaPath?: string
  state: StreamState
  live: boolean
  startedAt: string | null
  tracks: string[]
  viewerCount: number | null
  checkedAt: string
}

export interface ChannelLiveUpdate {
  playback?: PublicChannel['playback']
  preferredPlayback?: PublicChannel['preferredPlayback']
  hasCompatibilityFallback?: boolean
  viewingAllowed?: boolean
  slug: string
  ownerName: string
  title: string
  discordNotificationsEnabled: boolean
  status: ChannelStatus
  poster: string | null
}

export interface ChannelStatusSnapshot {
  channels: ChannelLiveUpdate[]
  updatedAt: string
}

export interface PublicChannel {
  viewingAllowed?: boolean
  slug: string
  ownerName: string
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
