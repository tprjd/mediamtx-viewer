import { describe, expect, it } from 'vitest'

import { calculateOracleStatus } from '@/lib/oracle-statistics-status'
import type {
  OracleCostSummary,
  OracleQuotaUsage,
  OracleSourceHealth,
} from '@/lib/oracle-statistics-types'

const checkedAt = '2026-08-31T12:00:00.000Z'

function source(
  key: OracleSourceHealth['key'],
  state: OracleSourceHealth['state'] = 'ok',
): OracleSourceHealth {
  return { key, state, checkedAt, label: key, message: 'Test source' }
}

function quota(projected: number | null): OracleQuotaUsage {
  return {
    key: 'ocpu',
    label: 'A1 OCPU',
    used: 100,
    projected,
    limit: 1_000,
    unit: 'OCPU-hours',
    scope: 'Tenancy',
  }
}

function cost(overrides: Partial<OracleCostSummary> = {}): OracleCostSummary {
  return {
    actual: 0,
    forecast: 0,
    currency: 'USD',
    lines: [],
    hasRelevantUnmappedUsage: false,
    ...overrides,
  }
}

const healthySources = [source('metadata'), source('usage'), source('inventory')]

describe('calculateOracleStatus', () => {
  it('never reports safe when billing is unavailable', () => {
    expect(
      calculateOracleStatus({
        cost: cost({ actual: null }),
        quotas: [quota(100)],
        sources: [source('metadata'), source('usage', 'error'), source('inventory')],
      }).status,
    ).toBe('unknown')
  })

  it('reports a non-trivial current-month charge before quota warnings', () => {
    expect(
      calculateOracleStatus({
        cost: cost({ actual: 0.01 }),
        quotas: [quota(990)],
        sources: healthySources,
      }).status,
    ).toBe('charge-detected')
  })

  it.each([
    [699, 'safe'],
    [700, 'watch'],
    [850, 'near-limit'],
  ] as const)('maps a projection of %s to %s', (projected, expected) => {
    expect(
      calculateOracleStatus({
        cost: cost(),
        quotas: [quota(projected)],
        sources: healthySources,
      }).status,
    ).toBe(expected)
  })

  it('stays unknown for relevant usage that cannot be mapped', () => {
    expect(
      calculateOracleStatus({
        cost: cost({ hasRelevantUnmappedUsage: true }),
        quotas: [quota(100)],
        sources: healthySources,
      }).status,
    ).toBe('unknown')
  })
})
