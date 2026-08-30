import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChannelViewer } from '@/components/channel-viewer'
import type { ChannelStatus, PublicChannel } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  useChannelStatus: vi.fn(),
}))

vi.mock('@/hooks/use-channel-status', () => ({
  useChannelStatus: mocks.useChannelStatus,
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
  checkedAt: '2026-08-30T12:00:00.000Z',
}

const offlineStatus: ChannelStatus = {
  state: 'offline',
  live: false,
  startedAt: null,
  tracks: [],
  checkedAt: '2026-08-30T12:05:00.000Z',
}

const channel: PublicChannel = {
  slug: 'live',
  displayName: 'Main channel',
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
    mocks.useChannelStatus.mockReset()
  })

  afterEach(cleanup)

  it('uses the polled status for the badge, player, and track metadata', () => {
    mocks.useChannelStatus.mockReturnValue(offlineStatus)

    render(<ChannelViewer channel={channel} />)

    expect(screen.getByText('Offline')).toBeInTheDocument()
    expect(screen.queryByText('Live')).toBeNull()
    expect(screen.queryByText('Opus · AV1')).toBeNull()
    expect(screen.getByTestId('live-player')).toHaveAttribute(
      'data-status',
      'offline',
    )
    expect(screen.getByTestId('live-player')).toHaveAttribute('data-poster', '')
  })

  it('keeps a manually configured poster while offline', () => {
    mocks.useChannelStatus.mockReturnValue(offlineStatus)

    render(<ChannelViewer channel={{ ...channel, poster: '/configured.jpg' }} />)

    expect(screen.getByTestId('live-player')).toHaveAttribute(
      'data-poster',
      '/configured.jpg',
    )
  })
})
