import { cleanup, render, screen, within } from '@testing-library/react'
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
  it('renders live and offline Channels in separate sections', () => {
    render(
      <HomeDashboard
        capabilities={{ isAdmin: false }}
        initialChannels={[
          channel('live', 'live-a', { title: 'Live A' }),
          channel('offline', 'offline-b', { title: 'Offline B' }),
        ]}
      />,
    )

    expect(screen.queryByText('What are we watching?')).toBeNull()
    expect(screen.queryByRole('link', { name: 'My channel' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Manage users' })).toBeNull()

    const liveSection = screen.getByRole('region', { name: 'Live Channels' })
    const offlineSection = screen.getByRole('region', {
      name: 'Offline Channels',
    })
    expect(
      within(liveSection).getByRole('link', {
        name: 'Watch Live A by David, live',
      }),
    ).toHaveAttribute('href', '/watch/live-a')
    expect(
      within(offlineSection).getByRole('link', {
        name: 'Watch Offline B by David, offline',
      }),
    ).toHaveAttribute('href', '/watch/offline-b')
  })

  it('renders the live section before the offline section', () => {
    render(
      <HomeDashboard
        capabilities={{ isAdmin: false }}
        initialChannels={[
          channel('offline', 'offline-z', { title: 'Offline Z' }),
          channel('live', 'live-a', { title: 'Live A' }),
        ]}
      />,
    )

    const sections = screen.getAllByRole('region')
    expect(sections[0]).toHaveAccessibleName('Live Channels')
    expect(sections[1]).toHaveAccessibleName('Offline Channels')
  })

  it('shows the live badge, viewer count, title, and owner on a card', () => {
    render(
      <HomeDashboard
        capabilities={{ isAdmin: false }}
        initialChannels={[channel('live')]}
      />,
    )

    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByLabelText('1 viewer')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Late-night games' })).toBeInTheDocument()
    expect(screen.getByText('David')).toBeInTheDocument()
  })

  it('shows when a live viewer count is unavailable', () => {
    const liveWithoutViewerCount = channel('live')
    liveWithoutViewerCount.status.viewerCount = null

    render(
      <HomeDashboard
        capabilities={{ isAdmin: false }}
        initialChannels={[liveWithoutViewerCount]}
      />,
    )

    expect(screen.getByText('Viewers unavailable')).toBeInTheDocument()
  })

  it('shows circular Channel owner initials with the card metadata', () => {
    render(
      <HomeDashboard
        capabilities={{ isAdmin: false }}
        initialChannels={[
          channel('live', 'live', { ownerName: 'David Foster' }),
        ]}
      />,
    )

    expect(screen.getByText('DF')).toBeInTheDocument()
    expect(screen.getByText('David Foster')).toBeInTheDocument()
  })

  it('keeps an unavailable Channel in the offline section with an accurate state', () => {
    render(
      <HomeDashboard
        capabilities={{ isAdmin: false }}
        initialChannels={[channel('unavailable', 'unavailable')]}
      />,
    )

    const offlineSection = screen.getByRole('region', {
      name: 'Offline Channels',
    })
    expect(
      within(offlineSection).getByRole('link', {
        name: 'Watch Late-night games by David, unavailable',
      }),
    ).toBeInTheDocument()
    expect(within(offlineSection).getByText('Status unavailable')).toBeVisible()
    expect(
      screen.getByRole('status', { name: 'Channel status' }),
    ).toHaveTextContent('Channel status updates are delayed.')
  })

  it('uses the poster image when the channel has one', () => {
    const withPoster = {
      ...channel('live'),
      poster: '/api/channels/live/thumbnail?v=123',
    }
    const { container } = render(
      <HomeDashboard
        capabilities={{ isAdmin: false }}
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
        capabilities={{ isAdmin: false }}
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
        capabilities={{ isAdmin: false }}
        initialChannels={[]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'No channels yet.' })).toBeInTheDocument()
  })

  it('offers channel setup only to administrators when the directory is empty', () => {
    const { rerender } = render(
      <HomeDashboard
        capabilities={{ isAdmin: false }}
        initialChannels={[]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'No channels yet.' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Grant streaming access' })).toBeNull()

    rerender(
      <HomeDashboard
        capabilities={{ isAdmin: true }}
        initialChannels={[]}
      />,
    )
    expect(
      screen.getByRole('link', { name: 'Grant streaming access' }),
    ).toHaveAttribute('href', '/admin/users')
  })
})
