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
    label:
      mode === 'ultra-low'
        ? `HLS ≤${timing.correctiveLatencyCeilingMs / 1000}s`
        : mode === 'balanced'
          ? 'Balanced'
          : 'Smooth',
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
