export type HlsLatencyProfile = 'ultra-low' | 'balanced' | 'smooth'
export type PlaybackMode = HlsLatencyProfile | 'webrtc'

interface HlsModeDocument {
  targetLatencyMs: number
  correctiveLatencyCeilingMs: number
  forwardBufferCeilingMs?: number
}

export interface StreamingContractDocument {
  schemaVersion: 1
  contractVersion: string
  hls: {
    packaging: {
      variant: 'lowLatency'
      alwaysRemux: true
      segmentDurationMs: number
      partDurationMs: number
    }
    modes: Record<HlsLatencyProfile, HlsModeDocument>
  }
  managedObs: {
    keyframeIntervalMs: number
  }
  fallbacks: {
    'ultra-low': {
      unavailable: HlsLatencyProfile
      unstable: HlsLatencyProfile
    }
    webrtc: {
      transportFailure: HlsLatencyProfile
      retryCooldownMs: number
    }
  }
  releaseValidation: {
    glassToGlassRequired: true
  }
}

export class StreamingContractError extends Error {
  constructor(
    public readonly code:
      | 'invalid_document'
      | 'unsupported_schema_version'
      | 'contract_invariant_violation',
    message: string,
  ) {
    super(message)
    this.name = 'StreamingContractError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new StreamingContractError('invalid_document', `${path} must be an object.`)
  }
  return value
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new StreamingContractError(
      'invalid_document',
      `${path} must contain only: ${wanted.join(', ')}.`,
    )
  }
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new StreamingContractError(
      'contract_invariant_violation',
      `${path} must be a positive integer.`,
    )
  }
  return value
}

function hlsMode(value: unknown, path: string, forwardBuffer: boolean): HlsModeDocument {
  const mode = recordAt(value, path)
  exactKeys(
    mode,
    forwardBuffer
      ? ['targetLatencyMs', 'correctiveLatencyCeilingMs', 'forwardBufferCeilingMs']
      : ['targetLatencyMs', 'correctiveLatencyCeilingMs'],
    path,
  )
  const targetLatencyMs = positiveInteger(mode.targetLatencyMs, `${path}.targetLatencyMs`)
  const correctiveLatencyCeilingMs = positiveInteger(
    mode.correctiveLatencyCeilingMs,
    `${path}.correctiveLatencyCeilingMs`,
  )
  if (targetLatencyMs > correctiveLatencyCeilingMs) {
    throw new StreamingContractError(
      'contract_invariant_violation',
      `${path}.targetLatencyMs cannot exceed its corrective ceiling.`,
    )
  }
  return {
    targetLatencyMs,
    correctiveLatencyCeilingMs,
    ...(forwardBuffer
      ? {
          forwardBufferCeilingMs: positiveInteger(
            mode.forwardBufferCeilingMs,
            `${path}.forwardBufferCeilingMs`,
          ),
        }
      : {}),
  }
}

function fallbackMode(value: unknown, path: string): HlsLatencyProfile {
  if (value === 'ultra-low' || value === 'balanced' || value === 'smooth') return value
  throw new StreamingContractError(
    'contract_invariant_violation',
    `${path} must name an HLS playback mode.`,
  )
}

export function compileStreamingContract(value: unknown): StreamingContractDocument {
  const document = recordAt(value, 'streamingContract')
  exactKeys(
    document,
    ['schemaVersion', 'contractVersion', 'hls', 'managedObs', 'fallbacks', 'releaseValidation'],
    'streamingContract',
  )
  if (document.schemaVersion !== 1) {
    throw new StreamingContractError(
      'unsupported_schema_version',
      `Unsupported streaming contract schema: ${String(document.schemaVersion)}.`,
    )
  }
  if (
    typeof document.contractVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(document.contractVersion)
  ) {
    throw new StreamingContractError(
      'contract_invariant_violation',
      'streamingContract.contractVersion must be a semantic version.',
    )
  }

  const hls = recordAt(document.hls, 'streamingContract.hls')
  exactKeys(hls, ['packaging', 'modes'], 'streamingContract.hls')
  const packaging = recordAt(hls.packaging, 'streamingContract.hls.packaging')
  exactKeys(
    packaging,
    ['variant', 'alwaysRemux', 'segmentDurationMs', 'partDurationMs'],
    'streamingContract.hls.packaging',
  )
  if (packaging.variant !== 'lowLatency' || packaging.alwaysRemux !== true) {
    throw new StreamingContractError(
      'contract_invariant_violation',
      'The HLS packaging contract requires lowLatency with alwaysRemux enabled.',
    )
  }
  const segmentDurationMs = positiveInteger(
    packaging.segmentDurationMs,
    'streamingContract.hls.packaging.segmentDurationMs',
  )
  const partDurationMs = positiveInteger(
    packaging.partDurationMs,
    'streamingContract.hls.packaging.partDurationMs',
  )
  if (partDurationMs > segmentDurationMs || segmentDurationMs % partDurationMs !== 0) {
    throw new StreamingContractError(
      'contract_invariant_violation',
      'HLS part duration must divide the segment duration evenly.',
    )
  }

  const modes = recordAt(hls.modes, 'streamingContract.hls.modes')
  exactKeys(modes, ['ultra-low', 'balanced', 'smooth'], 'streamingContract.hls.modes')
  const managedObs = recordAt(document.managedObs, 'streamingContract.managedObs')
  exactKeys(managedObs, ['keyframeIntervalMs'], 'streamingContract.managedObs')
  const keyframeIntervalMs = positiveInteger(
    managedObs.keyframeIntervalMs,
    'streamingContract.managedObs.keyframeIntervalMs',
  )
  if (keyframeIntervalMs % 1_000 !== 0) {
    throw new StreamingContractError(
      'contract_invariant_violation',
      'Managed OBS keyframe interval must be a whole number of seconds.',
    )
  }
  const fallbacks = recordAt(document.fallbacks, 'streamingContract.fallbacks')
  exactKeys(fallbacks, ['ultra-low', 'webrtc'], 'streamingContract.fallbacks')
  const ultraLowFallback = recordAt(
    fallbacks['ultra-low'],
    'streamingContract.fallbacks.ultra-low',
  )
  exactKeys(
    ultraLowFallback,
    ['unavailable', 'unstable'],
    'streamingContract.fallbacks.ultra-low',
  )
  const webRtcFallback = recordAt(fallbacks.webrtc, 'streamingContract.fallbacks.webrtc')
  exactKeys(
    webRtcFallback,
    ['transportFailure', 'retryCooldownMs'],
    'streamingContract.fallbacks.webrtc',
  )
  const releaseValidation = recordAt(
    document.releaseValidation,
    'streamingContract.releaseValidation',
  )
  exactKeys(
    releaseValidation,
    ['glassToGlassRequired'],
    'streamingContract.releaseValidation',
  )
  if (releaseValidation.glassToGlassRequired !== true) {
    throw new StreamingContractError(
      'contract_invariant_violation',
      'Release validation must require a glass-to-glass observation.',
    )
  }

  return {
    schemaVersion: 1,
    contractVersion: document.contractVersion,
    hls: {
      packaging: {
        variant: 'lowLatency',
        alwaysRemux: true,
        segmentDurationMs,
        partDurationMs,
      },
      modes: {
        'ultra-low': hlsMode(modes['ultra-low'], 'streamingContract.hls.modes.ultra-low', true),
        balanced: hlsMode(modes.balanced, 'streamingContract.hls.modes.balanced', false),
        smooth: hlsMode(modes.smooth, 'streamingContract.hls.modes.smooth', false),
      },
    },
    managedObs: {
      keyframeIntervalMs,
    },
    fallbacks: {
      'ultra-low': {
        unavailable: fallbackMode(
          ultraLowFallback.unavailable,
          'streamingContract.fallbacks.ultra-low.unavailable',
        ),
        unstable: fallbackMode(
          ultraLowFallback.unstable,
          'streamingContract.fallbacks.ultra-low.unstable',
        ),
      },
      webrtc: {
        transportFailure: fallbackMode(
          webRtcFallback.transportFailure,
          'streamingContract.fallbacks.webrtc.transportFailure',
        ),
        retryCooldownMs: positiveInteger(
          webRtcFallback.retryCooldownMs,
          'streamingContract.fallbacks.webrtc.retryCooldownMs',
        ),
      },
    },
    releaseValidation: { glassToGlassRequired: true },
  }
}
