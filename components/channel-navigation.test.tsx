import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ChannelNavigation } from '@/components/channel-navigation'
import type { PublicChannel } from '@/lib/types'

const channels: PublicChannel[] = [
  {
    slug: 'live',
    ownerName: 'Live Owner',
    title: 'Live Channel',
    accentColor: '#8b5cf6',
    preferredPlayback: 'webrtc',
    hasCompatibilityFallback: false,
    playback: {
      hls: '/media/hls/live/index.m3u8',
      webrtc: '/media/whep/live/whep',
    },
    status: {
      state: 'live',
      live: true,
      startedAt: '2026-09-09T12:00:00.000Z',
      tracks: [],
      viewerCount: 5,
      checkedAt: '2026-09-09T12:00:00.000Z',
    },
  },
  {
    slug: 'offline',
    ownerName: 'Offline Owner',
    title: 'Offline Channel',
    accentColor: '#ec4899',
    preferredPlayback: 'hls',
    hasCompatibilityFallback: false,
    playback: {
      hls: '/media/hls/offline/index.m3u8',
      webrtc: '/media/whep/offline/whep',
    },
    status: {
      state: 'offline',
      live: false,
      startedAt: null,
      tracks: [],
      viewerCount: 0,
      checkedAt: '2026-09-09T12:00:00.000Z',
    },
  },
]

beforeEach(() => {
  document.body.innerHTML = '<div id="channel-drawer-trigger"></div>'
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 412,
  })
})

afterEach(cleanup)

describe('ChannelNavigation', () => {
  it('opens the Channel drawer and returns focus after Escape', async () => {
    render(<ChannelNavigation channels={channels} watchedSlug="live" />)

    const trigger = await screen.findByRole('button', {
      name: 'Open Channel drawer',
    })
    fireEvent.click(trigger)

    const drawer = screen.getByRole('dialog', { name: 'Channels' })
    expect(
      within(drawer).getByRole('link', { name: /Live Channel by Live Owner/ }),
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(drawer).getByRole('link', {
        name: /Offline Channel by Offline Owner/,
      }),
    ).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(drawer).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('closes the drawer after a viewer selects a Channel', async () => {
    render(<ChannelNavigation channels={channels} watchedSlug="live" />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Channel drawer' }),
    )
    const drawer = screen.getByRole('dialog', { name: 'Channels' })
    const channelLink = within(drawer).getByRole('link', {
      name: /Offline Channel by Offline Owner/,
    })
    channelLink.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(channelLink)

    await waitFor(() => expect(drawer).not.toBeInTheDocument())
  })
})
