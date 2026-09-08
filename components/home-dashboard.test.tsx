import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HomeDashboard } from '@/components/home-dashboard'
import type { PublicChannel, StreamState } from '@/lib/types'

function channel(
  state: StreamState,
  slug = 'live',
  overrides: Partial<PublicChannel> = {},
): PublicChannel {
  return {
    slug,
    ownerName: 'David',
    title: 'Late-night games',
    description: 'Playing from home.',
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
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('HomeDashboard', () => {
  it('renders every channel as a card in the grid', () => {
    render(
      <HomeDashboard
        capabilities={{ hasOwnedChannel: false, isAdmin: false }}
        initialChannels={[
          channel('live', 'live-a', { title: 'Live A' }),
          channel('offline', 'offline-b', { title: 'Offline B' }),
        ]}
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'What are we watching?' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'All channels' })).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'Watch Live A by David, live',
      }),
    ).toHaveAttribute('href', '/watch/live-a')
    expect(
      screen.getByRole('link', {
        name: 'Watch Offline B by David, offline',
      }),
    ).toHaveAttribute('href', '/watch/offline-b')
  })

  it('sorts live channels before offline channels in the grid', () => {
    const { container } = render(
      <HomeDashboard
        capabilities={{ hasOwnedChannel: false, isAdmin: false }}
        initialChannels={[
          channel('offline', 'offline-z', { title: 'Offline Z' }),
          channel('live', 'live-a', { title: 'Live A' }),
        ]}
      />,
    )

    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', '/watch/live-a')
    expect(links[1]).toHaveAttribute('href', '/watch/offline-z')
  })

  it('shows the live badge, viewer count, title, and owner on a card', () => {
    render(
      <HomeDashboard
        capabilities={{ hasOwnedChannel: false, isAdmin: false }}
        initialChannels={[channel('live')]}
      />,
    )

    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByLabelText('1 viewer')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Late-night games' })).toBeInTheDocument()
    expect(screen.getByText('David')).toBeInTheDocument()
  })

  it('uses the poster image when the channel has one', () => {
    const withPoster = {
      ...channel('live'),
      poster: '/api/channels/live/thumbnail?v=123',
    }
    const { container } = render(
      <HomeDashboard
        capabilities={{ hasOwnedChannel: false, isAdmin: false }}
        initialChannels={[withPoster]}
      />,
    )

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      withPoster.poster,
    )
  })

  it('shows the channel initial when no poster is set', () => {
    const { container } = render(
      <HomeDashboard
        capabilities={{ hasOwnedChannel: false, isAdmin: false }}
        initialChannels={[channel('live')]}
      />,
    )

    expect(container.querySelector('img')).toBeNull()
    const card = container.querySelector('a')
    const media = card?.querySelector('div')
    expect(media?.querySelector('span')).toHaveTextContent('L')
  })

  it('renders a quiet note when no channels exist', () => {
    render(
      <HomeDashboard
        capabilities={{ hasOwnedChannel: false, isAdmin: false }}
        initialChannels={[]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'No channels yet.' })).toBeInTheDocument()
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