import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  window.localStorage.clear()
  setViewportWidth(1440)
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

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
    expect(screen.getByRole('heading', { name: 'Live' })).toBeInTheDocument()
  })

  it('renders a thin icon rail for a collapsed preference', () => {
    window.localStorage.setItem(
      LIVE_RAIL_PREFERENCE_STORAGE_KEY,
      'collapsed',
    )

    render(
      <LiveRail
        channels={[channel('alpha', true, { title: 'Alpha stream' })]}
        watchedSlug="alpha"
      />,
    )

    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.queryByText('Alpha stream')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Live' })).toBeNull()
  })

  it('toggles between expanded and collapsed forms', () => {
    render(
      <LiveRail
        channels={[channel('alpha', true, { title: 'Alpha stream' })]}
        watchedSlug="alpha"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse live rail' }))

    expect(window.localStorage.getItem(LIVE_RAIL_PREFERENCE_STORAGE_KEY)).toBe('collapsed')
    expect(screen.queryByText('Alpha stream')).toBeNull()
    expect(screen.getByRole('button', { name: 'Expand live rail' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand live rail' }))

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

    expect(screen.getByText('A')).toBeInTheDocument()
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

  it('renders nothing for a hidden preference', () => {
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

    expect(screen.queryByRole('complementary', { name: 'Live channels' })).toBeNull()
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
