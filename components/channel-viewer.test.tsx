import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChannelViewer } from '@/components/channel-viewer'
import type { ChannelStatus, PublicChannel } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  useChannelEvents: vi.fn(),
}))

vi.mock('@/hooks/use-channel-events', () => ({
  useChannelEvents: mocks.useChannelEvents,
}))

vi.mock('@/components/live-player', () => ({
  LivePlayer: ({ channel }: { channel: PublicChannel }) => (
    <div
      data-poster={channel.poster ?? ''}
      data-status={channel.status.state}
      data-testid="live-player"
    />
  ),
}))

vi.mock('@/components/share-button', () => ({
  ShareButton: () => null,
}))

const liveStatus: ChannelStatus = {
  state: 'live',
  live: true,
  startedAt: '2026-08-30T12:00:00.000Z',
  tracks: ['Opus', 'AV1'],
  viewerCount: 2,
  checkedAt: '2026-08-30T12:00:00.000Z',
}

const offlineStatus: ChannelStatus = {
  state: 'offline',
  live: false,
  startedAt: null,
  tracks: [],
  viewerCount: 0,
  checkedAt: '2026-08-30T12:05:00.000Z',
}

const channel: PublicChannel = {
  slug: 'live',
  ownerName: 'David',
  title: 'Late-night games',
  poster: '/api/channels/live/thumbnail?v=123',
  accentColor: '#8b5cf6',
  preferredPlayback: 'webrtc',
  hasCompatibilityFallback: false,
  playback: {
    hls: '/media/hls/live/index.m3u8',
    webrtc: '/media/whep/live/whep',
  },
  status: liveStatus,
}

describe('ChannelViewer', () => {
  beforeEach(() => {
    mocks.useChannelEvents.mockReset()
  })

  afterEach(cleanup)

  it('uses the event status for the badge, player, and track metadata', () => {
    mocks.useChannelEvents.mockReturnValue({
      channels: [
        {
          ...channel,
          poster: undefined,
          status: offlineStatus,
        },
      ],
      statusDelayed: false,
    })

    render(<ChannelViewer channel={channel} />)

    expect(screen.getByText('Offline')).toBeInTheDocument()
    expect(screen.queryByText('Live')).toBeNull()
    expect(screen.queryByText('Opus · AV1')).toBeNull()
    expect(screen.queryByText('Main channel')).toBeNull()
    expect(screen.getByText('David')).toBeInTheDocument()
    expect(screen.getByTestId('live-player')).toHaveAttribute(
      'data-status',
      'offline',
    )
    expect(screen.getByTestId('live-player')).toHaveAttribute('data-poster', '')
  })

  it('keeps a manually configured poster while offline', () => {
    mocks.useChannelEvents.mockReturnValue({
      channels: [
        {
          ...channel,
          poster: '/configured.jpg',
          status: offlineStatus,
        },
      ],
      statusDelayed: false,
    })

    render(<ChannelViewer channel={{ ...channel, poster: '/configured.jpg' }} />)

    expect(screen.getByTestId('live-player')).toHaveAttribute(
      'data-poster',
      '/configured.jpg',
    )
  })

  it('shows the current viewer count while live', () => {
    mocks.useChannelEvents.mockReturnValue({
      channels: [{ ...channel, status: liveStatus }],
      statusDelayed: false,
    })

    render(<ChannelViewer channel={channel} />)

    expect(screen.getByLabelText('2 viewers')).toHaveTextContent('2 viewers')
  })
})
