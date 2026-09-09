import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LiveRail } from '@/components/live-rail'
import { LIVE_RAIL_PREFERENCE_STORAGE_KEY } from '@/lib/live-rail-preferences'
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

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  })
  window.dispatchEvent(new Event('resize'))
}

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverStub
  window.localStorage.clear()
  setViewportWidth(1440)
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('LiveRail', () => {
  it('lists live Channels before other Channels with accurate state labels', () => {
    render(
      <LiveRail
        channels={[
          channel('alpha', true, { title: 'Alpha stream' }),
          channel('offline', false),
          channel('unavailable', false, {
            status: {
              ...channel('unavailable', false).status,
              state: 'unavailable',
            },
          }),
        ]}
        watchedSlug="alpha"
      />,
    )

    const rail = screen.getByRole('complementary', { name: 'Channels' })
    expect(within(rail).getByRole('link', { name: /Alpha stream by alpha owner/ })).toHaveAttribute(
      'href',
      '/watch/alpha',
    )
    expect(screen.getByText('alpha owner')).toBeInTheDocument()
    expect(screen.getByLabelText('4 viewers')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /offline channel by offline owner, offline/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /unavailable channel by unavailable owner, unavailable/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Live Channels' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Other Channels' })).toBeInTheDocument()
    expect(screen.getByText('Offline')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(within(rail).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/watch/alpha',
      '/watch/offline',
      '/watch/unavailable',
    ])
  })

  it('renders owner initials and accessible details for a collapsed preference', async () => {
    window.localStorage.setItem(
      LIVE_RAIL_PREFERENCE_STORAGE_KEY,
      'collapsed',
    )

    render(
      <LiveRail
        channels={[
          channel('alpha', true, {
            ownerName: 'Alice Smith',
            title: 'Alpha stream',
          }),
          channel('offline', false, {
            ownerName: 'Olivia North',
            title: 'Offline stream',
          }),
          channel('unknown-viewers', true, {
            ownerName: 'Una Vale',
            status: {
              ...channel('unknown-viewers', true).status,
              viewerCount: null,
            },
            title: 'Unknown viewers',
          }),
        ]}
        watchedSlug="alpha"
      />,
    )

    expect(screen.getByText('AS')).toBeInTheDocument()
    expect(screen.getByText('ON')).toBeInTheDocument()
    expect(screen.queryByText('Alpha stream')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Live Channels' })).toBeNull()

    const alphaLink = screen.getByRole('link', {
      name: 'Watch Alpha stream by Alice Smith, live, 4 viewers',
    })
    fireEvent.focus(alphaLink)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      /Alpha stream.*Alice Smith.*Live 4 viewers/,
    )

    fireEvent.blur(alphaLink)
    fireEvent.focus(
      screen.getByRole('link', {
        name: 'Watch Offline stream by Olivia North, offline',
      }),
    )
    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveTextContent(
        /Offline stream.*Olivia North.*Offline/,
      )
    })

    fireEvent.blur(document.activeElement!)
    fireEvent.focus(
      screen.getByRole('link', {
        name: 'Watch Unknown viewers by Una Vale, live, viewer count unavailable',
      }),
    )
    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveTextContent(
        /Unknown viewers.*Una Vale.*Live.*Viewer count unavailable/,
      )
    })
  })

  it('toggles between expanded and collapsed forms', () => {
    render(
      <LiveRail
        channels={[channel('alpha', true, { title: 'Alpha stream' })]}
        watchedSlug="alpha"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Channel rail' }))

    expect(window.localStorage.getItem(LIVE_RAIL_PREFERENCE_STORAGE_KEY)).toBe('collapsed')
    expect(screen.queryByText('Alpha stream')).toBeNull()
    expect(screen.getByRole('button', { name: 'Expand Channel rail' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand Channel rail' }))

    expect(window.localStorage.getItem(LIVE_RAIL_PREFERENCE_STORAGE_KEY)).toBe('expanded')
    expect(screen.getByText('Alpha stream')).toBeInTheDocument()
  })

  it('auto-collapses an expanded preference below 1280px', () => {
    window.localStorage.setItem(
      LIVE_RAIL_PREFERENCE_STORAGE_KEY,
      'expanded',
    )
    setViewportWidth(1279)

    render(
      <LiveRail
        channels={[channel('alpha', true, { title: 'Alpha stream' })]}
        watchedSlug="alpha"
      />,
    )

    expect(screen.getByText('AO')).toBeInTheDocument()
    expect(screen.queryByText('Alpha stream')).toBeNull()
  })

  it('restores the persisted expanded form at full width', () => {
    window.localStorage.setItem(
      LIVE_RAIL_PREFERENCE_STORAGE_KEY,
      'expanded',
    )

    render(
      <LiveRail
        channels={[channel('alpha', true, { title: 'Alpha stream' })]}
        watchedSlug="alpha"
      />,
    )

    setViewportWidth(1280)

    expect(screen.getByText('Alpha stream')).toBeInTheDocument()
  })

  it('starts expanded when storage contains the removed hidden preference', () => {
    window.localStorage.setItem(
      LIVE_RAIL_PREFERENCE_STORAGE_KEY,
      'hidden',
    )

    render(
      <LiveRail
        channels={[channel('alpha', true)]}
        watchedSlug="alpha"
      />,
    )

    expect(screen.getByRole('complementary', { name: 'Channels' })).toHaveAttribute(
      'data-rail-state',
      'expanded',
    )
    expect(screen.getByText('alpha channel')).toBeInTheDocument()
  })

  it('marks the watched live channel as current', () => {
    render(
      <LiveRail
        channels={[channel('alpha', true), channel('beta', false)]}
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

  it('keeps offline navigation when no Channel is live', () => {
    render(
      <LiveRail
        channels={[channel('offline', false)]}
        watchedSlug="offline"
      />,
    )

    expect(screen.getByText('No Channels are live.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /offline channel/ })).toBeInTheDocument()
  })
})
