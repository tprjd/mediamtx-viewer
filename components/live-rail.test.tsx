import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LiveRail } from '@/components/live-rail'
import type { PublicChannel } from '@/lib/types'

function channel(
  slug: string,
  live: boolean,
  overrides: Partial<PublicChannel> = {},
): PublicChannel {
  return {
    slug,
    ownerName: `${slug} owner`,
    title: `${slug} channel`,
    accentColor: '#8b5cf6',
    preferredPlayback: 'webrtc',
    hasCompatibilityFallback: false,
    playback: {
      hls: `/media/hls/${slug}/index.m3u8`,
      webrtc: `/media/whep/${slug}/whep`,
    },
    status: {
      state: live ? 'live' : 'offline',
      live,
      startedAt: live ? '2026-08-30T12:00:00.000Z' : null,
      tracks: [],
      viewerCount: live ? 4 : 0,
      checkedAt: '2026-08-30T12:00:00.000Z',
    },
    ...overrides,
  }
}

afterEach(cleanup)

describe('LiveRail', () => {
  it('lists live channels with their owner and viewer count', () => {
    render(
      <LiveRail
        channels={[
          channel('alpha', true, { title: 'Alpha stream' }),
          channel('offline', false),
        ]}
        watchedSlug="alpha"
      />,
    )

    expect(screen.getByRole('complementary', { name: 'Live channels' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Alpha stream by alpha owner/ })).toHaveAttribute(
      'href',
      '/watch/alpha',
    )
    expect(screen.getByText('alpha owner')).toBeInTheDocument()
    expect(screen.getByLabelText('4 viewers')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /offline channel/ })).toBeNull()
  })

  it('marks the watched live channel as current', () => {
    render(
      <LiveRail
        channels={[channel('alpha', true), channel('beta', true)]}
        watchedSlug="beta"
      />,
    )

    expect(screen.getByRole('link', { name: /beta channel/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: /alpha channel/ })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('shows an empty note when no channel is live', () => {
    render(
      <LiveRail
        channels={[channel('offline', false)]}
        watchedSlug="offline"
      />,
    )

    expect(screen.getByText('No live channels')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
