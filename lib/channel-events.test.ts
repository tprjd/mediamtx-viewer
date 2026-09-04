import { describe, expect, it } from 'vitest'

import {
  isChannelLiveUpdate,
  isChannelStatusSnapshot,
  mergeChannelLiveUpdates,
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

  it('updates only live presentation state and removes a cleared poster', () => {
    const [merged] = mergeChannelLiveUpdates([channel], [liveUpdate])
    expect(merged).toMatchObject({
      title: 'Alice stream',
      poster: '/new.jpg',
      status: { state: 'live', viewerCount: 2 },
    })

    const [withoutPoster] = mergeChannelLiveUpdates(
      [merged!],
      [{ ...liveUpdate, poster: null }],
    )
    expect(withoutPoster?.poster).toBeUndefined()
  })
})
