import { describe, expect, it } from 'vitest'

import type { Channel } from '@/lib/channel-schema'
import { toPublicChannel } from '@/lib/public-channel'
import type { ChannelStatus } from '@/lib/types'

const channel: Channel = {
  slug: 'friend',
  mediaPath: 'relay/friend',
  displayName: 'Friend',
  title: 'Friend stream',
  accentColor: '#22c55e',
  preferredPlayback: 'hls',
}

const status: ChannelStatus = {
  state: 'live',
  live: true,
  startedAt: '2026-08-27T20:00:00Z',
  tracks: ['AV1', 'MPEG-4 Audio'],
  checkedAt: '2026-08-27T20:01:00Z',
}

describe('toPublicChannel', () => {
  it('returns same-origin playback URLs without exposing the internal API', () => {
    const result = toPublicChannel(channel, status)

    expect(result.playback.hls).toBe(
      '/media/hls/relay/friend/index.m3u8?cookieCheck=1',
    )
    expect(result.playback.webrtc).toBe('/media/whep/relay/friend/whep')
    expect(JSON.stringify(result)).not.toContain('9997')
  })
})
