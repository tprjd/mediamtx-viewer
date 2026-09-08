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
): PublicChannel {
  return {
    slug,
    ownerName: `${slug} owner`,
    title: `${slug} title`,
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
  it('sorts live channels first, then viewer count descending, then title', () => {
    const sorted = sortChannelsForHome([
      channel('offline-alpha', 'offline', 5),
      channel('live-low', 'live', 1),
      channel('offline-beta', 'offline', 9),
      channel('live-high', 'live', 20),
      channel('live-mid', 'live', 10),
    ])

    expect(sorted.map(({ slug }) => slug)).toEqual([
      'live-high',
      'live-mid',
      'live-low',
      'offline-beta',
      'offline-alpha',
    ])
  })

  it('breaks viewer count ties by title ascending', () => {
    const sorted = sortChannelsForHome([
      channel('zebra', 'offline', 3),
      channel('apple', 'offline', 3),
      channel('mango', 'offline', 3),
    ])

    expect(sorted.map(({ slug }) => slug)).toEqual(['apple', 'mango', 'zebra'])
  })

  it('treats a missing viewer count as zero without reordering groups', () => {
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
  it('keeps the full directory sorted with live channels first', () => {
    const model = buildHomeDashboardModel([
      channel('offline-first'),
      channel('live-first', 'live'),
      channel('live-second', 'live'),
      channel('offline-last'),
    ])

    expect(model.allChannels.map(({ slug }) => slug)).toEqual([
      'live-first',
      'live-second',
      'offline-first',
      'offline-last',
    ])
    expect(model.liveCount).toBe(2)
  })

  it('returns a deliberate empty model when there are no channels', () => {
    expect(buildHomeDashboardModel([])).toEqual({
      allChannels: [],
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
