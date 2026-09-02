import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LivePlayer } from '@/components/live-player'
import type { PublicChannel } from '@/lib/types'

vi.mock('@/components/hls-player', () => ({
  HlsPlayer: ({
    latencyProfile,
    onBalancedUnavailable,
  }: {
    latencyProfile: string
    onBalancedUnavailable: () => void
  }) => (
    <div>
      {latencyProfile === 'balanced' ? 'Balanced player' : 'Smooth player'}
      {latencyProfile === 'balanced' && (
        <button onClick={onBalancedUnavailable}>Simulate unavailable</button>
      )}
    </div>
  ),
}))

vi.mock('@/components/webrtc-player', () => ({
  WebRtcPlayer: ({ onFallback }: { onFallback: () => void }) => (
    <div>
      Low-latency player
      <button onClick={onFallback}>Simulate fallback</button>
    </div>
  ),
}))

const channel: PublicChannel = {
  slug: 'live',
  ownerName: 'David',
  title: 'Late-night games',
  accentColor: '#8b5cf6',
  preferredPlayback: 'hls',
  hasCompatibilityFallback: false,
  playback: {
    hls: '/media/hls/live/index.m3u8',
    webrtc: '/media/whep/live/whep',
  },
  status: {
    state: 'live',
    live: true,
    startedAt: '2026-08-30T12:00:00.000Z',
    tracks: ['Opus', 'AV1'],
    viewerCount: 1,
    checkedAt: '2026-08-30T12:00:00.000Z',
  },
}

describe('LivePlayer playback mode', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('defaults to balanced playback and offers all three modes', () => {
    render(<LivePlayer channel={channel} />)
    expect(screen.getByText('Balanced player')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Balanced' })).toBePressed()
    expect(screen.getByRole('button', { name: 'Smooth' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Low latency' }))

    expect(screen.getByText('Low-latency player')).toBeInTheDocument()
    expect(window.sessionStorage.getItem('mediamtx-viewer:playback-mode')).toBe(
      'webrtc',
    )
  })

  it('falls back once and prevents automatic protocol oscillation for 60 seconds', () => {
    render(<LivePlayer channel={channel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Low latency' }))
    fireEvent.click(screen.getByRole('button', { name: 'Simulate fallback' }))

    expect(screen.getByText('Smooth player')).toBeInTheDocument()
    expect(window.sessionStorage.getItem('mediamtx-viewer:playback-mode')).toBe(
      'smooth',
    )
    expect(
      screen.getByRole('button', { name: 'Try low latency in 60s' }),
    ).toBeDisabled()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(screen.getByRole('button', { name: 'Low latency' })).toBeEnabled()
    expect(screen.getByText('Smooth player')).toBeInTheDocument()
  })

  it('restores the session playback preference on remount', () => {
    window.sessionStorage.setItem('mediamtx-viewer:playback-mode', 'webrtc')
    render(<LivePlayer channel={channel} />)
    act(() => vi.advanceTimersByTime(0))

    expect(screen.getByText('Low-latency player')).toBeInTheDocument()
  })

  it('migrates the legacy HLS session preference to balanced', () => {
    window.sessionStorage.setItem('mediamtx-viewer:playback-mode', 'hls')
    render(<LivePlayer channel={channel} />)
    act(() => vi.advanceTimersByTime(0))

    expect(screen.getByText('Balanced player')).toBeInTheDocument()
    expect(window.sessionStorage.getItem('mediamtx-viewer:playback-mode')).toBe(
      'balanced',
    )
  })

  it('remembers an explicit smooth preference', () => {
    render(<LivePlayer channel={channel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Smooth' }))

    expect(screen.getByText('Smooth player')).toBeInTheDocument()
    expect(window.sessionStorage.getItem('mediamtx-viewer:playback-mode')).toBe(
      'smooth',
    )
  })

  it('falls back to smooth when native HLS cannot expose a live edge', () => {
    render(<LivePlayer channel={channel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Simulate unavailable' }))

    expect(screen.getByText('Smooth player')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Balanced unavailable' }),
    ).toBeDisabled()
    expect(window.sessionStorage.getItem('mediamtx-viewer:playback-mode')).toBe(
      'smooth',
    )
  })
})
