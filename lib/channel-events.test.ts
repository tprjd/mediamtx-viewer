import { describe, expect, it } from 'vitest'

import {
  isChannelLiveUpdate,
  isChannelStatusSnapshot,
  isChannelsResponse,
} from '@/lib/channel-events'
import type { ChannelLiveUpdate, PublicChannel } from '@/lib/types'

const channel: PublicChannel = {
  slug: 'alice',
  ownerName: 'Alice',
  title: 'Alice stream',
  poster: '/old.jpg',
  accentColor: '#8b5cf6',
  preferredPlayback: 'webrtc',
  hasCompatibilityFallback: false,
  playback: {
    hls: '/media/hls/channels/alice/index.m3u8',
    webrtc: '/media/whep/channels/alice/whep',
  },
  status: {
    state: 'offline',
    live: false,
    startedAt: null,
    tracks: [],
    viewerCount: 0,
    checkedAt: '2026-08-31T10:00:00.000Z',
  },
}

const liveUpdate: ChannelLiveUpdate = {
  slug: 'alice',
  ownerName: 'Alice',
  title: 'Alice stream',
  discordNotificationsEnabled: true,
  poster: '/new.jpg',
  status: {
    state: 'live',
    live: true,
    startedAt: '2026-08-31T10:01:00.000Z',
    tracks: ['AV1', 'Opus'],
    viewerCount: 2,
    checkedAt: '2026-08-31T10:01:02.000Z',
  },
}

describe('channel events', () => {
  it('validates event payloads', () => {
    expect(isChannelLiveUpdate(liveUpdate)).toBe(true)
    expect(
      isChannelStatusSnapshot({
        channels: [liveUpdate],
        updatedAt: '2026-08-31T10:01:02.000Z',
      }),
    ).toBe(true)
    expect(
      isChannelLiveUpdate({
        ...liveUpdate,
        status: { ...liveUpdate.status, viewerCount: -1 },
      }),
    ).toBe(false)
  })

  it('validates full polling responses before they can replace the directory', () => {
    const response = { channels: [channel], updatedAt: channel.status.checkedAt }
    expect(isChannelsResponse(response)).toBe(true)
    expect(isChannelsResponse({ ...response, channels: [{}] })).toBe(false)
    expect(isChannelsResponse({ ...response, updatedAt: 'invalid' })).toBe(false)
    expect(isChannelsResponse({ ...response, channels: [{ ...channel, playback: null }] })).toBe(false)
  })

  it('rejects inconsistent states and invalid timestamps for both transports', () => {
    const status = { ...liveUpdate.status, live: false }
    expect(isChannelLiveUpdate({ ...liveUpdate, status })).toBe(false)
    expect(isChannelsResponse({ channels: [{ ...channel, status }], updatedAt: status.checkedAt })).toBe(false)
    expect(isChannelLiveUpdate({ ...liveUpdate, status: { ...status, checkedAt: 'invalid' } })).toBe(false)
  })
})
