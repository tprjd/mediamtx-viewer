import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HomeDashboard } from '@/components/home-dashboard'
import type { PublicChannel, StreamState } from '@/lib/types'

function channel(state: StreamState): PublicChannel {
  return {
    slug: 'live',
    ownerName: 'David',
    title: 'Late-night games',
    description: 'Playing from home.',
    accentColor: '#8b5cf6',
    preferredPlayback: 'webrtc',
    hasCompatibilityFallback: false,
    playback: {
      hls: '/media/hls/live/index.m3u8',
      webrtc: '/media/whep/live/whep',
    },
    status: {
      state,
      live: state === 'live',
      startedAt: null,
      tracks: [],
      checkedAt: '2026-08-30T12:00:00.000Z',
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HomeDashboard', () => {
  it('features a live channel and keeps it in the complete directory', () => {
    render(
      <HomeDashboard
        capabilities={{ hasOwnedChannel: false, isAdmin: false }}
        initialChannels={[channel('live')]}
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'What are we watching?' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Live now' })).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', {
        name: 'Watch Late-night games by David, live',
      }),
    ).toHaveLength(2)
    expect(screen.getAllByText('David')).toHaveLength(2)
  })

  it('shows the intentional quiet state while preserving offline navigation', () => {
    render(
      <HomeDashboard
        capabilities={{ hasOwnedChannel: false, isAdmin: false }}
        initialChannels={[channel('offline')]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Quiet right now.' })).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'Watch Late-night games by David, offline',
      }),
    ).toBeInTheDocument()
  })

  it('uses a generated thumbnail when one is available', () => {
    const withThumbnail = {
      ...channel('live'),
      poster: '/api/channels/live/thumbnail?v=123',
    }
    const { container } = render(
      <HomeDashboard
        capabilities={{ hasOwnedChannel: false, isAdmin: false }}
        initialChannels={[withThumbnail]}
      />,
    )

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      withThumbnail.poster,
    )
  })

  it('offers channel setup only to administrators when the directory is empty', () => {
    const { rerender } = render(
      <HomeDashboard
        capabilities={{ hasOwnedChannel: false, isAdmin: false }}
        initialChannels={[]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'No channels yet.' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Grant streaming access' })).toBeNull()

    rerender(
      <HomeDashboard
        capabilities={{ hasOwnedChannel: false, isAdmin: true }}
        initialChannels={[]}
      />,
    )
    expect(
      screen.getByRole('link', { name: 'Grant streaming access' }),
    ).toHaveAttribute('href', '/admin/users')
  })
})
