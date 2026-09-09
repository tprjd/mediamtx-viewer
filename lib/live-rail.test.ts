import { describe, expect, it } from 'vitest'

import { buildLiveRailModel } from '@/lib/live-rail'
import type { PublicChannel, StreamState } from '@/lib/types'

function channel(
  slug: string,
  state: StreamState,
  viewerCount: number | null,
  title = slug,
): PublicChannel {
  return {
    slug,
    ownerName: `${slug} owner`,
    title,
    accentColor: '#8b5cf6',
    preferredPlayback: 'webrtc',
    hasCompatibilityFallback: false,
    playback: {
      hls: `/media/hls/${slug}/index.m3u8`,
      webrtc: `/media/whep/${slug}/whep`,
    },
    status: {
      state,
      live: state === 'live',
      startedAt: state === 'live' ? '2026-08-30T12:00:00.000Z' : null,
      tracks: [],
      viewerCount,
      checkedAt: '2026-08-30T12:00:00.000Z',
    },
  }
}

describe('live rail model', () => {
  it('groups live Channels before other Channels and preserves the watched slug', () => {
    const model = buildLiveRailModel(
      [
        channel('offline', 'offline', 0),
        channel('quiet', 'live', 1),
        channel('popular', 'live', 8),
        channel('unavailable', 'unavailable', null),
      ],
      'quiet',
    )

    expect(model.liveChannels.map((item) => item.slug)).toEqual([
      'popular',
      'quiet',
    ])
    expect(model.otherChannels.map((item) => item.slug)).toEqual([
      'offline',
      'unavailable',
    ])
    expect(model.watchedSlug).toBe('quiet')
  })

  it('uses the title as the stable tie-break for live channels', () => {
    const model = buildLiveRailModel(
      [
        channel('zulu', 'live', 2, 'Zulu'),
        channel('alpha', 'live', 2, 'Alpha'),
      ],
      'zulu',
    )

    expect(model.liveChannels.map((item) => item.title)).toEqual([
      'Alpha',
      'Zulu',
    ])
  })

  it('sorts offline and unavailable Channels by title', () => {
    const model = buildLiveRailModel(
      [
        channel('zulu', 'offline', 0, 'Zulu'),
        channel('bravo', 'unavailable', null, 'Bravo'),
        channel('alpha', 'offline', 0, 'Alpha'),
      ],
      'zulu',
    )

    expect(model.otherChannels.map((item) => item.title)).toEqual([
      'Alpha',
      'Bravo',
      'Zulu',
    ])
  })
})
