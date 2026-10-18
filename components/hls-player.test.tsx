import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import Hls from 'hls.js'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HlsPlayer } from '@/components/hls-player'
import type { VidstackPlayer } from '@/components/vidstack-player'
import type { PublicChannel } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  player: vi.fn(),
  stats: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/components/vidstack-player', async () => {
  const React = await import('react')
  return {
    VidstackPlayer: (props: ComponentProps<typeof VidstackPlayer>) => {
      mocks.player(props)
      const videoRef = React.useRef<HTMLVideoElement>(null)
      const { onProviderAttachmentChange } = props
      React.useEffect(() => {
        onProviderAttachmentChange?.({ kind: 'native', video: videoRef.current! })
        return () => onProviderAttachmentChange?.(null)
      }, [onProviderAttachmentChange])
      return <div><video aria-label={props.ariaLabel} ref={videoRef} />{props.children}</div>
    },
  }
})
vi.mock('@/components/playback-stats', () => ({
  PlaybackStats: (props: unknown) => { mocks.stats(props); return null },
}))
vi.mock('@/lib/auth/client', () => ({ authClient: { getSession: mocks.getSession } }))

const channel: PublicChannel = {
  slug: 'live', ownerName: 'David', title: 'Late-night games', accentColor: '#8b5cf6',
  preferredPlayback: 'hls', hasCompatibilityFallback: true,
  playback: {
    hls: '/media/hls/live/index.m3u8',
    fallbackHls: '/media/hls/compatible/index.m3u8',
    webrtc: '/media/whep/live/whep',
  },
  status: {
    state: 'live', live: true, startedAt: null, tracks: ['AV1', 'Opus'],
    viewerCount: 1, checkedAt: '2026-10-18T00:00:00.000Z',
  },
}

async function reportUnsupportedVideo() {
  const video = screen.getByLabelText('Late-night games live video')
  Object.defineProperty(video, 'error', { configurable: true, value: { code: 4 } })
  fireEvent.error(video)
  await act(async () => vi.advanceTimersByTimeAsync(2_500))
}

describe('HlsPlayer rendering', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.player.mockClear()
    mocks.stats.mockClear()
    mocks.getSession.mockResolvedValue({ data: { user: { id: 'viewer' } } })
    vi.spyOn(Hls, 'isSupported').mockReturnValue(false)
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably')
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.stubGlobal('MediaError', { MEDIA_ERR_SRC_NOT_SUPPORTED: 4 })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the playback state, label, statistics, and shared controls', () => {
    const onOpenChat = vi.fn()
    const onTheaterModeChange = vi.fn()
    const statsTarget = document.createElement('div')
    render(<HlsPlayer channel={channel} latencyProfile="smooth" chatOpen={false}
      onOpenChat={onOpenChat} onTheaterModeChange={onTheaterModeChange} theaterMode
      statsTarget={statsTarget} />)
    expect(screen.getByRole('heading', { name: 'Joining stream' })).toBeInTheDocument()

    const video = screen.getByLabelText('Late-night games live video')
    fireEvent.playing(video)
    expect(screen.queryByRole('heading', { name: 'Joining stream' })).not.toBeInTheDocument()
    expect(screen.getByText('HLS · Smooth')).toBeInTheDocument()
    expect(mocks.player.mock.lastCall?.[0]).toMatchObject({
      chatOpen: false, onOpenChat, onTheaterModeChange, theaterMode: true,
      src: { src: channel.playback.hls }, streamType: 'll-live', seekableLive: true,
    })
    const stats = mocks.stats.mock.lastCall?.[0]
    expect(stats).toMatchObject({
      playing: true, protocol: 'HLS', tracks: channel.status.tracks,
      hlsDiagnostics: { targetLatencySeconds: 5 },
    })
    expect(stats.statsTarget).toBe(statsTarget)
    expect(stats.videoRef.current).toBe(video)
  })

  it('selects compatibility playback from the unsupported-format message', async () => {
    render(<HlsPlayer channel={channel} latencyProfile="balanced" />)
    await reportUnsupportedVideo()
    expect(screen.getByRole('heading', { name: 'Video format not supported' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try compatibility stream' }))
    expect(mocks.player.mock.lastCall?.[0].src.src).toBe(channel.playback.fallbackHls)

    await reportUnsupportedVideo()
    expect(screen.getByText('The compatibility stream is also unavailable on this browser or device.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try compatibility stream' })).not.toBeInTheDocument()
  })

  it('shows the offline state and keeps summary statistics when the detail panel is hidden', () => {
    const summaryTarget = document.createElement('div')
    const offline = { ...channel, status: { ...channel.status, state: 'offline' as const, live: false } }
    render(<HlsPlayer channel={offline} latencyProfile="balanced" showStats={false} summaryTarget={summaryTarget} />)
    expect(screen.getByText('Stream offline')).toBeInTheDocument()
    expect(mocks.player.mock.lastCall?.[0].src).toBeUndefined()
    expect(mocks.stats.mock.lastCall?.[0]).toMatchObject({ playing: false, showStats: false, summaryTarget })
  })
})
