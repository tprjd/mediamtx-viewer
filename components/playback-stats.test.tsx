import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PlaybackStats,
  sumInboundPacketsLost,
} from '@/components/playback-stats'

afterEach(cleanup)

describe('sumInboundPacketsLost', () => {
  it('sums packets lost across inbound audio and video streams', () => {
    expect(
      sumInboundPacketsLost([{ packetsLost: 12 }, {}, { packetsLost: 7 }]),
    ).toBe(19)
  })

  it('returns undefined when inbound stats do not report packet loss', () => {
    expect(sumInboundPacketsLost([{}, {}])).toBeUndefined()
    expect(sumInboundPacketsLost([])).toBeUndefined()
  })
})

describe('PlaybackStats packet-loss diagnostic', () => {
  it('renders cumulative receiver-side packet loss', async () => {
    const video = document.createElement('video')
    const peerConnection = {
      connectionState: 'connected',
      getStats: vi.fn().mockResolvedValue(
        new Map([
          [
            'audio-inbound',
            { id: 'audio-inbound', type: 'inbound-rtp', kind: 'audio', packetsLost: 3 },
          ],
          [
            'video-inbound',
            { id: 'video-inbound', type: 'inbound-rtp', kind: 'video', packetsLost: 14 },
          ],
        ]),
      ),
    } as unknown as RTCPeerConnection

    render(
      <PlaybackStats
        peerConnection={peerConnection}
        playing
        protocol="WebRTC"
        tracks={['AV1', 'Opus']}
        videoRef={{ current: video }}
      />,
    )

    await waitFor(() => expect(screen.getByText('17')).toBeInTheDocument())
    expect(screen.getByText('Packets lost')).toBeInTheDocument()
  })

  it('falls back to an em dash when packet loss is unavailable', async () => {
    const video = document.createElement('video')
    const peerConnection = {
      connectionState: 'connected',
      getStats: vi.fn().mockResolvedValue(
        new Map([
          ['video-inbound', { id: 'video-inbound', type: 'inbound-rtp', kind: 'video' }],
        ]),
      ),
    } as unknown as RTCPeerConnection

    render(
      <PlaybackStats
        peerConnection={peerConnection}
        playing
        protocol="WebRTC"
        tracks={[]}
        videoRef={{ current: video }}
      />,
    )

    await waitFor(() => expect(peerConnection.getStats).toHaveBeenCalled())
    const label = screen.getByText('Packets lost')
    expect(label.nextElementSibling).toHaveTextContent('—')
  })
})
