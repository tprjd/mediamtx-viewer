import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChannelViewer } from '@/components/channel-viewer'
import { CHAT_PREFERENCE_STORAGE_KEY } from '@/lib/chat-preferences'
import type { ChannelStatus, PublicChannel } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  useChannelEvents: vi.fn(),
}))

vi.mock('@/hooks/use-channel-events', () => ({
  useChannelEvents: mocks.useChannelEvents,
}))

vi.mock('@/components/live-player', () => ({
  LivePlayer: ({
    channel,
    playbackControlsTarget,
    playbackStatsTarget,
  }: {
    channel: PublicChannel
    playbackControlsTarget?: HTMLElement | null
    playbackStatsTarget?: HTMLElement | null
  }) => {
    const [mode, setMode] = useState<'balanced' | 'smooth'>('balanced')

    return (
      <>
        <div
          data-poster={channel.poster ?? ''}
          data-status={channel.status.state}
          data-testid="live-player"
        />
        {channel.status.live && playbackControlsTarget
          ? createPortal(
              <>
                <button
                  aria-pressed={mode === 'balanced'}
                  onClick={() => setMode('balanced')}
                  type="button"
                >
                  Balanced
                </button>
                <button
                  aria-pressed={mode === 'smooth'}
                  onClick={() => setMode('smooth')}
                  type="button"
                >
                  Smooth
                </button>
              </>,
              playbackControlsTarget,
            )
          : null}
        {channel.status.live && playbackStatsTarget
          ? createPortal(
              <div aria-label="Playback diagnostics">
                <span>Live latency</span>
              </div>,
              playbackStatsTarget,
            )
          : null}
      </>
    )
  },
}))

vi.mock('@/components/share-button', () => ({
  ShareButton: () => (
    <button aria-label="Share this stream" type="button">
      Share
    </button>
  ),
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

const unavailableStatus: ChannelStatus = {
  ...offlineStatus,
  state: 'unavailable',
  viewerCount: null,
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
    document.body.innerHTML =
      '<div id="channel-drawer-trigger"></div><div id="chat-restore-target"></div>'
    window.localStorage.clear()
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1440,
    })
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

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

    expect(
      within(screen.getByRole('region', { name: 'Channel information' })).getByText(
        'Offline',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Opus · AV1')).toBeNull()
    expect(screen.queryByText('Main channel')).toBeNull()
    expect(
      within(screen.getByRole('region', { name: 'Channel information' })).getByText(
        'David',
      ),
    ).toBeInTheDocument()
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

  it('selects the watched channel from the shared all-channel event state', () => {
    const otherChannel = {
      ...channel,
      slug: 'other',
      ownerName: 'Other owner',
      title: 'Other stream',
    }
    mocks.useChannelEvents.mockReturnValue({
      channels: [otherChannel, { ...channel, status: offlineStatus }],
      statusDelayed: false,
    })

    render(<ChannelViewer channel={channel} channels={[channel, otherChannel]} />)

    expect(screen.getByTestId('live-player')).toHaveAttribute(
      'data-status',
      'offline',
    )
    expect(
      screen.getByRole('link', { name: /Other stream by Other owner/ }),
    ).toBeInTheDocument()
  })

  it('shows the current viewer count while live', () => {
    mocks.useChannelEvents.mockReturnValue({
      channels: [{ ...channel, status: liveStatus }],
      statusDelayed: false,
    })

    render(<ChannelViewer channel={channel} />)

    expect(
      within(screen.getByRole('region', { name: 'Channel information' })).getByLabelText(
        '2 viewers',
      ),
    ).toHaveTextContent('2 viewers')
    expect(screen.getByRole('complementary', { name: 'Chat placeholder' })).toBeInTheDocument()
    expect(screen.getByText('Chat is coming soon')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Chat message' })).toBeDisabled()
  })

  it('keeps common details visible and puts live playback tools in settings', () => {
    mocks.useChannelEvents.mockReturnValue({
      channels: [{ ...channel, status: liveStatus }],
      statusDelayed: false,
    })

    render(<ChannelViewer channel={channel} />)

    const details = screen.getByRole('region', { name: 'Channel information' })
    expect(within(details).getByRole('heading', { name: channel.title })).toBeInTheDocument()
    expect(within(details).getByText(channel.ownerName)).toBeInTheDocument()
    expect(within(details).getByLabelText('2 viewers')).toBeInTheDocument()
    expect(
      within(details).getByRole('button', { name: 'Share this stream' }),
    ).toBeInTheDocument()

    const settings = screen.getByRole('button', {
      name: 'Show playback settings',
    })
    expect(settings).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Balanced' })).toBeNull()
    expect(screen.queryByLabelText('Playback diagnostics')).toBeNull()

    fireEvent.click(settings)

    expect(
      screen.getByRole('button', { name: 'Hide playback settings' }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Balanced' })).toBeVisible()
    expect(screen.getByLabelText('Playback diagnostics')).toBeVisible()
    expect(screen.getByText('Opus · AV1')).toBeVisible()
  })

  it('keeps the selected playback mode when settings closes and reopens', () => {
    mocks.useChannelEvents.mockReturnValue({
      channels: [{ ...channel, status: liveStatus }],
      statusDelayed: false,
    })

    render(<ChannelViewer channel={channel} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Show playback settings' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Smooth' }))
    expect(screen.getByRole('button', { name: 'Smooth' })).toBePressed()

    fireEvent.click(
      screen.getByRole('button', { name: 'Hide playback settings' }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Show playback settings' }),
    )

    expect(screen.getByRole('button', { name: 'Smooth' })).toBePressed()
  })

  it('hides the chat placeholder when the channel is offline', () => {
    mocks.useChannelEvents.mockReturnValue({
      channels: [{ ...channel, status: offlineStatus }],
      statusDelayed: false,
    })

    render(<ChannelViewer channel={channel} />)

    expect(screen.queryByRole('complementary', { name: 'Chat placeholder' })).toBeNull()
    expect(
      within(screen.getByRole('region', { name: 'Channel information' })).getByText(
        'Offline',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Share this stream' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Show playback settings' }),
    ).toBeNull()
    expect(screen.queryByLabelText('Playback diagnostics')).toBeNull()
  })

  it('hides the chat placeholder when the Channel is unavailable', () => {
    mocks.useChannelEvents.mockReturnValue({
      channels: [{ ...channel, status: unavailableStatus }],
      statusDelayed: true,
    })

    render(<ChannelViewer channel={channel} />)

    expect(screen.queryByRole('complementary', { name: 'Chat placeholder' })).toBeNull()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Show playback settings' }),
    ).toBeNull()
    expect(screen.queryByLabelText('Playback diagnostics')).toBeNull()
  })

  it('places the version footer below the Channel details', () => {
    mocks.useChannelEvents.mockReturnValue({
      channels: [{ ...channel, status: offlineStatus }],
      statusDelayed: false,
    })

    render(<ChannelViewer channel={channel} />)

    const details = screen.getByRole('region', { name: 'Channel information' })
    const footer = screen.getByRole('contentinfo')
    expect(footer).toHaveTextContent('v0.6.2')
    expect(details.compareDocumentPosition(footer)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('saves a closed chat choice and restores it from the compact header control', () => {
    mocks.useChannelEvents.mockReturnValue({
      channels: [{ ...channel, status: liveStatus }],
      statusDelayed: false,
    })

    render(<ChannelViewer channel={channel} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close Chat' }))

    expect(screen.queryByRole('complementary', { name: 'Chat placeholder' })).toBeNull()
    expect(window.localStorage.getItem(CHAT_PREFERENCE_STORAGE_KEY)).toBe('closed')
    fireEvent.click(screen.getByRole('button', { name: 'Open Chat' }))
    expect(screen.getByRole('complementary', { name: 'Chat placeholder' })).toBeInTheDocument()
    expect(window.localStorage.getItem(CHAT_PREFERENCE_STORAGE_KEY)).toBe('open')
  })

  it('starts the below-player Chat disclosure collapsed on a narrow layout', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 768,
    })
    mocks.useChannelEvents.mockReturnValue({
      channels: [{ ...channel, status: liveStatus }],
      statusDelayed: false,
    })

    render(<ChannelViewer channel={channel} />)

    const chatToggle = screen.getByRole('button', { name: 'Chat' })
    expect(chatToggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(chatToggle)

    expect(chatToggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox', { name: 'Chat message' })).toBeDisabled()
  })
})
