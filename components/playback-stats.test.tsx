import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PlaybackStats,
  sumInboundPacketsLost,
  summarizeFramePacing,
} from '@/components/playback-stats'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('summarizeFramePacing', () => {
  it('calculates rolling source and presentation timing with late frames', () => {
    const summary = summarizeFramePacing([
      {
        mediaIntervalMs: 16.6,
        presentationIntervalMs: 16,
        presentationTime: 0,
        processingDurationMs: 2,
      },
      {
        mediaIntervalMs: 16.7,
        presentationIntervalMs: 17,
        presentationTime: 17,
        processingDurationMs: 3,
      },
      {
        mediaIntervalMs: 16.7,
        presentationIntervalMs: 18,
        presentationTime: 35,
        processingDurationMs: 2,
      },
      {
        mediaIntervalMs: 16.6,
        presentationIntervalMs: 34,
        presentationTime: 69,
        processingDurationMs: 3,
      },
    ])

    expect(summary.mediaAverageMs).toBeCloseTo(16.65)
    expect(summary.mediaP95Ms).toBe(16.7)
    expect(summary.presentationAverageMs).toBeCloseTo(21.25)
    expect(summary.presentationP95Ms).toBe(34)
    expect(summary.decodeTimeMs).toBe(2.5)
    expect(summary.lateFrames).toBe(1)
    expect(summary.sampleCount).toBe(4)
  })

  it('keeps only the latest ten seconds', () => {
    const summary = summarizeFramePacing([
      { mediaIntervalMs: 50, presentationIntervalMs: 50, presentationTime: 0 },
      { mediaIntervalMs: 16.7, presentationIntervalMs: 17, presentationTime: 12_000 },
    ])

    expect(summary.sampleCount).toBe(1)
    expect(summary.presentationAverageMs).toBe(17)
  })
})

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

describe('PlaybackStats diagnostics', () => {
  it('renders HLS edge diagnostics and copies a privacy-safe support snapshot', async () => {
    const video = document.createElement('video')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(
      <PlaybackStats
        hlsDiagnostics={{
          bufferAheadSeconds: 4.2,
          engine: 'hls.js',
          lastCorrection: 'hls.js latency exceeded 6s',
          liveLatencySeconds: 3.4,
          maxLatencySeconds: 6,
          partHoldBackSeconds: 0.5,
          partTargetSeconds: 0.2,
          playbackRate: 1.03,
          playingDateLatencySeconds: 3.7,
          targetDurationSeconds: 2,
          targetLatencySeconds: 3,
        }}
        playing
        protocol="HLS"
        tracks={['AV1', 'Opus']}
        videoRef={{ current: video }}
      />,
    )

    expect(screen.getByText('Live latency').nextElementSibling).toHaveTextContent(
      '3.4s',
    )
    expect(screen.getByText('Target / max').nextElementSibling).toHaveTextContent(
      '3s / 6s',
    )
    expect(screen.getByText('Engine / rate').nextElementSibling).toHaveTextContent(
      'hls.js · 1.03×',
    )

    screen.getByRole('button', { name: 'Copy snapshot' }).click()
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    const snapshot = JSON.parse(writeText.mock.calls[0][0]) as {
      browser: string
      playback: { hls: { liveLatencySeconds: number }; protocol: string }
    }
    expect(snapshot.browser).toContain('Mozilla')
    expect(snapshot.playback.protocol).toBe('HLS')
    expect(snapshot.playback.hls.liveLatencySeconds).toBe(3.4)
    expect(writeText.mock.calls[0][0]).not.toContain('cookie')
  })

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

  it('renders WebRTC decoder, jitter-buffer, and freeze metrics', async () => {
    const video = document.createElement('video')
    const peerConnection = {
      connectionState: 'connected',
      getStats: vi.fn().mockResolvedValue(
        new Map([
          [
            'video-inbound',
            {
              id: 'video-inbound',
              type: 'inbound-rtp',
              kind: 'video',
              framesDecoded: 120,
              freezeCount: 2,
              jitterBufferDelay: 6,
              jitterBufferEmittedCount: 120,
              totalDecodeTime: 0.24,
            },
          ],
        ]),
      ),
    } as unknown as RTCPeerConnection

    render(
      <PlaybackStats
        peerConnection={peerConnection}
        playing
        protocol="WebRTC"
        tracks={['AV1']}
        videoRef={{ current: video }}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Decode/process').nextElementSibling).toHaveTextContent(
        '2.0 ms',
      )
    })
    expect(screen.getByText('Jitter buffer').nextElementSibling).toHaveTextContent(
      '50.0 ms',
    )
    expect(screen.getByText('Freezes').nextElementSibling).toHaveTextContent('2')
  })

  it('renders rolling presented-frame pacing from video callbacks', async () => {
    vi.useFakeTimers()
    const video = document.createElement('video')
    let callback:
      | ((now: number, metadata: {
          expectedDisplayTime: number
          mediaTime: number
          presentationTime: number
          presentedFrames: number
          processingDuration?: number
        }) => void)
      | undefined
    Object.defineProperty(video, 'requestVideoFrameCallback', {
      configurable: true,
      value: vi.fn((nextCallback) => {
        callback = nextCallback
        return 1
      }),
    })
    Object.defineProperty(video, 'cancelVideoFrameCallback', {
      configurable: true,
      value: vi.fn(),
    })

    render(
      <PlaybackStats
        playing
        protocol="HLS"
        tracks={['AV1']}
        videoRef={{ current: video }}
      />,
    )

    const present = (presentationTime: number, mediaTime: number, frame: number) => {
      const currentCallback = callback
      expect(currentCallback).toBeDefined()
      act(() => {
        currentCallback?.(presentationTime, {
          expectedDisplayTime: presentationTime,
          mediaTime,
          presentationTime,
          presentedFrames: frame,
          processingDuration: 0.002,
        })
      })
    }

    present(0, 0, 1)
    present(16.7, 0.0167, 2)
    present(33.4, 0.0334, 3)
    present(66.8, 0.0501, 4)

    await act(async () => {
      vi.advanceTimersByTime(1_000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('Source frame').nextElementSibling).toHaveTextContent(
      '16.7 / 16.7 ms',
    )
    expect(screen.getByText('Presented frame').nextElementSibling).toHaveTextContent(
      '22.3 / 33.4 ms',
    )
    expect(screen.getByText('Late frames').nextElementSibling).toHaveTextContent(
      '1 / 3',
    )
  })
})
