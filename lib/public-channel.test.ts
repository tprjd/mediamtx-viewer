import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Channel } from '@/lib/channel-schema'
import { toPublicChannel } from '@/lib/public-channel'
import type { ChannelStatus } from '@/lib/types'

const channel: Channel = {
  slug: 'friend',
  mediaPath: 'relay/friend',
  ownerName: 'Friend',
  title: 'Friend stream',
  accentColor: '#22c55e',
  preferredPlayback: 'hls',
  discordNotificationsEnabled: true,
}

const status: ChannelStatus = {
  state: 'live',
  live: true,
  startedAt: '2026-08-27T20:00:00Z',
  tracks: ['AV1', 'MPEG-4 Audio'],
  viewerCount: 1,
  checkedAt: '2026-08-27T20:01:00Z',
}

describe('toPublicChannel', () => {
  it('returns same-origin playback URLs without exposing the internal API', () => {
    const result = toPublicChannel(
      channel,
      status,
      '/api/channels/friend/thumbnail?v=123',
    )

    expect(result.playback.hls).toBe(
      '/media/hls/relay/friend/index.m3u8?cookieCheck=1',
    )
    expect(result.playback.webrtc).toBe('/media/whep/relay/friend/whep')
    expect(result.poster).toBe('/api/channels/friend/thumbnail?v=123')
    expect(result.ownerName).toBe('Friend')
    expect(result).not.toHaveProperty('displayName')
    expect(JSON.stringify(result)).not.toContain('9997')
  })
})

afterEach(() => vi.unstubAllEnvs())
it('defaults only a live compatible pilot WHIP Publisher to WebRTC', () => {
  vi.stubEnv('WHIP_PILOT_CHANNEL', 'friend')
  const whip = { ...status, publisherProtocol: 'whip' as const, tracks: ['H264', 'Opus'] }
  expect(toPublicChannel(channel, whip).preferredPlayback).toBe('webrtc')
  expect(toPublicChannel(channel, { ...whip, live: false }).preferredPlayback).toBe('hls')
  expect(toPublicChannel(channel, { ...whip, publisherProtocol: 'other' }).preferredPlayback).toBe('hls')
  expect(toPublicChannel(channel, { ...whip, tracks: ['H264', 'MPEG-4 Audio'] }).preferredPlayback).toBe('hls')
  vi.stubEnv('WHIP_PILOT_CHANNEL', '')
  expect(toPublicChannel(channel, whip).preferredPlayback).toBe('hls')
})
