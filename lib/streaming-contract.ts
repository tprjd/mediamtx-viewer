import contractDocument from '@/config/streaming-contract.v1.json'
import {
  compileStreamingContract,
  type HlsLatencyProfile,
  type PlaybackMode,
} from '@/lib/streaming-contract-core'

export type { HlsLatencyProfile, PlaybackMode }

const contract = compileStreamingContract(contractDocument)

export const STREAMING_CONTRACT_VERSION = contract.contractVersion

export interface HlsPlaybackContract {
  targetLatencySeconds: number
  correctiveLatencyCeilingSeconds: number
  forwardBufferCeilingSeconds?: number
  maxBufferLengthSeconds?: number
  adaptiveMaxSegmentSeconds?: number
  label: string
}

export interface ObsTimingProjection {
  contractVersion: string
  keyframeIntervalSeconds: number
}

export interface MediaMtxTimingProjection {
  hlsVariant: 'lowLatency'
  hlsAlwaysRemux: true
  hlsSegmentDuration: string
  hlsPartDuration: string
}

export interface HlsPackagingContract {
  segmentDurationSeconds: number
  partDurationSeconds: number
}

export function hlsPlaybackContract(mode: HlsLatencyProfile): HlsPlaybackContract {
  const timing = contract.hls.modes[mode]
  return {
    targetLatencySeconds: timing.targetLatencyMs / 1000,
    correctiveLatencyCeilingSeconds:
      timing.correctiveLatencyCeilingMs / 1000,
    ...(timing.forwardBufferCeilingMs === undefined
      ? {}
      : { forwardBufferCeilingSeconds: timing.forwardBufferCeilingMs / 1000 }),
    ...(timing.maxBufferLengthMs === undefined
      ? {}
      : { maxBufferLengthSeconds: timing.maxBufferLengthMs / 1000 }),
    ...(timing.adaptiveMaxSegmentMs === undefined
      ? {}
      : { adaptiveMaxSegmentSeconds: timing.adaptiveMaxSegmentMs / 1000 }),
    label:
      mode === 'ultra-low'
        ? 'Low (best-possible)'
        : mode === 'balanced'
          ? 'Balanced'
          : 'Smooth',
  }
}


export interface AdaptiveLatencyProfile {
  targetLatencySeconds: number
  correctiveLatencyCeilingSeconds: number
  maxBufferLengthSeconds: number
}

function roundSeconds(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Picks the lowest achievable ultra-low latency target for a stream with the
 * given average segment duration. Segments are the floor for how tight the
 * live edge can be, so longer segments raise the target, ceiling, and buffer
 * together. The 200 ms part contract is enforced separately by the player.
 */
export function adaptiveLatencyProfile(
  averageSegmentSeconds: number | undefined,
): AdaptiveLatencyProfile {
  const base = hlsPlaybackContract('ultra-low')
  if (
    averageSegmentSeconds === undefined ||
    averageSegmentSeconds <= 2.0
  ) {
    return {
      targetLatencySeconds: base.targetLatencySeconds,
      correctiveLatencyCeilingSeconds: base.correctiveLatencyCeilingSeconds,
      maxBufferLengthSeconds:
        base.maxBufferLengthSeconds ?? base.correctiveLatencyCeilingSeconds,
    }
  }
  const midCeiling = base.adaptiveMaxSegmentSeconds ?? 4.0
  if (averageSegmentSeconds <= midCeiling) {
    return {
      targetLatencySeconds: roundSeconds(averageSegmentSeconds * 0.8),
      correctiveLatencyCeilingSeconds: roundSeconds(
        averageSegmentSeconds * 1.05,
      ),
      maxBufferLengthSeconds: roundSeconds(averageSegmentSeconds * 0.875),
    }
  }
  const segmentCeil = Math.ceil(averageSegmentSeconds)
  return {
    targetLatencySeconds: segmentCeil,
    correctiveLatencyCeilingSeconds: segmentCeil + 1,
    maxBufferLengthSeconds: segmentCeil - 0.25,
  }
}

export function ultraLowFallback(
  exit: 'unavailable' | 'unstable',
): HlsLatencyProfile {
  return contract.fallbacks['ultra-low'][exit]
}

export function webRtcTransportFallback(): {
  mode: HlsLatencyProfile
  retryCooldownMs: number
} {
  return {
    mode: contract.fallbacks.webrtc.transportFailure,
    retryCooldownMs: contract.fallbacks.webrtc.retryCooldownMs,
  }
}

export function obsTimingProjection(): ObsTimingProjection {
  return {
    contractVersion: contract.contractVersion,
    keyframeIntervalSeconds: contract.managedObs.keyframeIntervalMs / 1000,
  }
}

export function hlsPackagingContract(): HlsPackagingContract {
  return {
    segmentDurationSeconds: contract.hls.packaging.segmentDurationMs / 1000,
    partDurationSeconds: contract.hls.packaging.partDurationMs / 1000,
  }
}

function mediaMtxDuration(milliseconds: number): string {
  return milliseconds % 1000 === 0
    ? `${milliseconds / 1000}s`
    : `${milliseconds}ms`
}

export function mediaMtxTimingProjection(): MediaMtxTimingProjection {
  return {
    hlsVariant: contract.hls.packaging.variant,
    hlsAlwaysRemux: contract.hls.packaging.alwaysRemux,
    hlsSegmentDuration: mediaMtxDuration(contract.hls.packaging.segmentDurationMs),
    hlsPartDuration: mediaMtxDuration(contract.hls.packaging.partDurationMs),
  }
}
