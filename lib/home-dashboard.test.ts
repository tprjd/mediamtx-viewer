import { describe, expect, it } from 'vitest'

import {
  buildHomeDashboardModel,
  mergeChannelsWithLastStatus,
  newlyLiveChannelNames,
  sortChannelsForHome,
} from '@/lib/home-dashboard'
import type { PublicChannel, StreamState } from '@/lib/types'

function channel(
  slug: string,
  state: StreamState = 'offline',
  viewerCount: number | null =
    state === 'live' ? 1 : state === 'offline' ? 0 : null,
  title = `${slug} title`,
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
      startedAt: null,
      tracks: [],
      viewerCount,
      checkedAt: '2026-08-30T12:00:00.000Z',
    },
  }
}

describe('sortChannelsForHome', () => {
  it('groups live Channels before offline and unavailable Channels', () => {
    const model = buildHomeDashboardModel([
      channel('offline-alpha', 'offline', 9),
      channel('live-low', 'live', 1),
      channel('unavailable-beta', 'unavailable'),
      channel('live-high', 'live', 20),
      channel('live-mid', 'live', 10),
    ])

    expect(model.liveChannels.map(({ slug }) => slug)).toEqual([
      'live-high',
      'live-mid',
      'live-low',
    ])
    expect(model.offlineChannels.map(({ slug }) => slug)).toEqual([
      'offline-alpha',
      'unavailable-beta',
    ])
  })

  it('breaks live viewer-count ties by title and keeps viewer order for title ties', () => {
    const sorted = sortChannelsForHome([
      channel('zebra', 'live', 3),
      channel('apple-low', 'live', 1, 'Apple'),
      channel('apple-high', 'live', 4, 'Apple'),
      channel('mango', 'live', 3),
    ])

    expect(sorted.map(({ slug }) => slug)).toEqual([
      'apple-high',
      'mango',
      'zebra',
      'apple-low',
    ])
  })

  it('treats a missing live viewer count as zero', () => {
    const sorted = sortChannelsForHome([
      channel('null-live', 'live', null),
      channel('counted-live', 'live', 4),
    ])

    expect(sorted.map(({ slug }) => slug)).toEqual([
      'counted-live',
      'null-live',
    ])
  })
})

describe('buildHomeDashboardModel', () => {
  it('sorts offline and unavailable Channels by title without using viewer counts', () => {
    const model = buildHomeDashboardModel([
      channel('zebra', 'offline', 100),
      channel('alpha', 'unavailable'),
      channel('mango', 'offline', 200),
    ])

    expect(model.liveChannels).toEqual([])
    expect(model.offlineChannels.map(({ slug }) => slug)).toEqual([
      'alpha',
      'mango',
      'zebra',
    ])
    expect(model.liveCount).toBe(0)
  })

  it('returns a deliberate empty model when there are no channels', () => {
    expect(buildHomeDashboardModel([])).toEqual({
      liveChannels: [],
      offlineChannels: [],
      liveCount: 0,
      statusUnavailable: false,
    })
  })

  it('distinguishes an unavailable status service from all-offline channels', () => {
    expect(
      buildHomeDashboardModel([channel('one', 'unavailable')])
        .statusUnavailable,
    ).toBe(true)
    expect(buildHomeDashboardModel([channel('one')]).statusUnavailable).toBe(
      false,
    )
  })
})

describe('newlyLiveChannelNames', () => {
  it('reports only channels that transitioned to live', () => {
    expect(
      newlyLiveChannelNames(
        [channel('one'), channel('two', 'live')],
        [channel('one', 'live'), channel('two', 'live')],
      ),
    ).toEqual(['one title'])
  })
})

describe('mergeChannelsWithLastStatus', () => {
  it('retains known statuses while accepting channel additions and removals', () => {
    const merged = mergeChannelsWithLastStatus(
      [channel('removed', 'live'), channel('kept', 'live')],
      [channel('kept', 'unavailable'), channel('added', 'unavailable')],
    )

    expect(merged.map(({ slug }) => slug)).toEqual(['kept', 'added'])
    expect(merged[0]?.status.state).toBe('live')
    expect(merged[1]?.status.state).toBe('unavailable')
  })
})
