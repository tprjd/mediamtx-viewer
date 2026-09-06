import { describe, expect, it } from 'vitest'

import contractDocument from '@/config/streaming-contract.v1.json'
import { compileStreamingContract, StreamingContractError } from '@/lib/streaming-contract-core'
import {
  adaptiveLatencyProfile,
  hlsPackagingContract,
  hlsPlaybackContract,
  mediaMtxTimingProjection,
  obsTimingProjection,
  STREAMING_CONTRACT_VERSION,
  ultraLowFallback,
  webRtcTransportFallback,
} from '@/lib/streaming-contract'

describe('streaming contract', () => {
  it('projects every approved playback policy', () => {
    expect(STREAMING_CONTRACT_VERSION).toBe('1.0.0')
    expect(hlsPlaybackContract('ultra-low')).toEqual({
      targetLatencySeconds: 1.8,
      correctiveLatencyCeilingSeconds: 3,
      forwardBufferCeilingSeconds: 3,
      maxBufferLengthSeconds: 2,
      adaptiveMaxSegmentSeconds: 4,
      label: 'Low (best-possible)',
    })
    expect(hlsPlaybackContract('balanced')).toEqual({
      targetLatencySeconds: 3,
      correctiveLatencyCeilingSeconds: 6,
      label: 'Balanced',
    })
    expect(hlsPlaybackContract('smooth')).toEqual({
      targetLatencySeconds: 5,
      correctiveLatencyCeilingSeconds: 9,
      label: 'Smooth',
    })
  })

  it('projects OBS, MediaMTX, and fallback policy', () => {
    expect(obsTimingProjection()).toEqual({
      contractVersion: '1.0.0',
      keyframeIntervalSeconds: 2,
    })
    expect(mediaMtxTimingProjection()).toEqual({
      hlsVariant: 'lowLatency',
      hlsAlwaysRemux: true,
      hlsSegmentDuration: '2s',
      hlsPartDuration: '200ms',
    })
    expect(hlsPackagingContract()).toEqual({
      segmentDurationSeconds: 2,
      partDurationSeconds: 0.2,
    })
    expect(ultraLowFallback('unavailable')).toBe('balanced')
    expect(ultraLowFallback('unstable')).toBe('balanced')
    expect(webRtcTransportFallback()).toEqual({
      mode: 'smooth',
      retryCooldownMs: 60_000,
    })
  })

  it('rejects incomplete documents and unsupported schemas', () => {
    expect(() =>
      compileStreamingContract({ schemaVersion: 1, contractVersion: '1.0.0' }),
    ).toThrowError(StreamingContractError)

    expect(() =>
      compileStreamingContract({
        schemaVersion: 2,
        contractVersion: '1.0.0',
        hls: {},
        managedObs: {},
        fallbacks: {},
        releaseValidation: {},
      }),
    ).toThrowError(expect.objectContaining({ code: 'unsupported_schema_version' }))
  })

  it('rejects a fractional-second managed OBS keyframe interval', () => {
    const invalidDocument = structuredClone(contractDocument)
    invalidDocument.managedObs.keyframeIntervalMs = 1_500

    expect(() => compileStreamingContract(invalidDocument)).toThrowError(
      expect.objectContaining({ code: 'contract_invariant_violation' }),
    )
  })

  it('maps average segment duration to an adaptive ultra-low target', () => {
    expect(adaptiveLatencyProfile(undefined)).toEqual({
      targetLatencySeconds: 1.8,
      correctiveLatencyCeilingSeconds: 3,
      maxBufferLengthSeconds: 2,
    })
    // <= 2s keeps the base ultra-low contract.
    expect(adaptiveLatencyProfile(2)).toEqual({
      targetLatencySeconds: 1.8,
      correctiveLatencyCeilingSeconds: 3,
      maxBufferLengthSeconds: 2,
    })
    // 3.2s segment -> target 2.56 / ceiling 3.36 / buffer 2.8.
    expect(adaptiveLatencyProfile(3.2)).toEqual({
      targetLatencySeconds: 2.56,
      correctiveLatencyCeilingSeconds: 3.36,
      maxBufferLengthSeconds: 2.8,
    })
    // 3.5s -> mid rule (2.8 / 3.68 / 3.06).
    expect(adaptiveLatencyProfile(3.5)).toEqual({
      targetLatencySeconds: 2.8,
      correctiveLatencyCeilingSeconds: 3.68,
      maxBufferLengthSeconds: 3.06,
    })
    // 4.167s crosses into the >4s bucket rule (5.0 / 6.0 / 4.75).
    expect(adaptiveLatencyProfile(4.167)).toEqual({
      targetLatencySeconds: 5,
      correctiveLatencyCeilingSeconds: 6,
      maxBufferLengthSeconds: 4.75,
    })
    // 5s+ uses the ceiling-bucket rule (5.0 / 6.0 / 4.75).
    expect(adaptiveLatencyProfile(5)).toEqual({
      targetLatencySeconds: 5,
      correctiveLatencyCeilingSeconds: 6,
      maxBufferLengthSeconds: 4.75,
    })
    expect(adaptiveLatencyProfile(6)).toEqual({
      targetLatencySeconds: 6,
      correctiveLatencyCeilingSeconds: 7,
      maxBufferLengthSeconds: 5.75,
    })
  })
})
