import { describe, expect, it } from 'vitest'

import {
  isWebRtcAvailable,
  webrtcUnavailableReason,
} from '@/lib/playback-availability'

describe('playback availability', () => {
  it('allows WebRTC for Opus sources', () => {
    expect(isWebRtcAvailable(['H265', 'Opus'])).toBe(true)
    expect(isWebRtcAvailable(['AV1', 'Opus'])).toBe(true)
  })

  it('allows video-only WebRTC (no audio track)', () => {
    expect(isWebRtcAvailable(['AV1'])).toBe(true)
    expect(isWebRtcAvailable(['H264'])).toBe(true)
  })

  it('greys WebRTC for AAC (RTMP ingest)', () => {
    expect(isWebRtcAvailable(['AV1', 'MPEG-4 Audio'])).toBe(false)
    expect(isWebRtcAvailable(['H265', 'MPEG-4 Audio'])).toBe(false)
    expect(webrtcUnavailableReason(['AV1', 'MPEG-4 Audio'])).toMatch(
      /audio codec/,
    )
  })

  it('greys WebRTC for unsupported video codecs', () => {
    expect(isWebRtcAvailable(['VP9', 'Opus'])).toBe(false)
    expect(webrtcUnavailableReason(['VP9', 'Opus'])).toMatch(/video codec/)
  })

  it('greys WebRTC for G711 audio', () => {
    expect(isWebRtcAvailable(['H264', 'G711'])).toBe(false)
  })
})
