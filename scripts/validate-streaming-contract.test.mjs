import { describe, expect, it } from 'vitest'

import contract from '../config/streaming-contract.v1.json' with { type: 'json' }
import { validateMediaMtxContract } from './validate-streaming-contract.mjs'

describe('MediaMTX streaming contract validation', () => {
  it('accepts the approved packaging settings', () => {
    expect(
      validateMediaMtxContract(
        contract,
        `hlsVariant: lowLatency
hlsAlwaysRemux: true
hlsSegmentDuration: 2s
hlsPartDuration: 200ms`,
      ),
    ).toEqual([])
  })

  it.each(['latencyCeilingMs', 'uploadInterruptionMs', 'recoveryDeadlineMs'])('rejects an invalid WebRTC target: %s', (target) => {
    const invalid = structuredClone(contract)
    invalid.webrtc[target] = 0
    expect(() => validateMediaMtxContract(invalid, '')).toThrow('canonical streaming contract is invalid')
  })

  it('reports every missing or mismatched setting', () => {
    expect(
      validateMediaMtxContract(
        contract,
        `hlsVariant: lowLatency
hlsAlwaysRemux: false
hlsSegmentDuration: 1s`,
      ),
    ).toEqual([
      { setting: 'hlsAlwaysRemux', expected: 'true', actual: 'false' },
      { setting: 'hlsSegmentDuration', expected: '2s', actual: '1s' },
      { setting: 'hlsPartDuration', expected: '200ms', actual: undefined },
    ])
  })
})
