import { describe, expect, it } from 'vitest'

import {
  buildHomeDashboardModel,
  mergeChannelsWithLastStatus,
  newlyLiveChannelNames,
} from '@/lib/home-dashboard'
import type { PublicChannel, StreamState } from '@/lib/types'

function channel(
  slug: string,
  state: StreamState = 'offline',
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
      viewerCount: state === 'live' ? 1 : state === 'offline' ? 0 : null,
      checkedAt: '2026-08-30T12:00:00.000Z',
    },
  }
}

describe('buildHomeDashboardModel', () => {
  it('selects the first live channel and keeps live channels first', () => {
    const model = buildHomeDashboardModel([
      channel('offline-first'),
      channel('live-first', 'live'),
      channel('live-second', 'live'),
      channel('offline-last'),
    ])

    expect(model.featuredChannel?.slug).toBe('live-first')
    expect(model.remainingLiveChannels.map(({ slug }) => slug)).toEqual([
      'live-second',
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
      featuredChannel: null,
      remainingLiveChannels: [],
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
