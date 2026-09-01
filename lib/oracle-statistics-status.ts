import type {
  OracleCostSummary,
  OracleOverallStatus,
  OracleQuotaUsage,
  OracleSourceHealth,
} from '@/lib/oracle-statistics-types'

export const CHARGE_TOLERANCE = 0.005
export const WATCH_RATIO = 0.7
export const NEAR_LIMIT_RATIO = 0.85

export function quotaRatio(quota: OracleQuotaUsage): number | null {
  const value = quota.projected ?? quota.used
  if (value === null || quota.limit <= 0) return null
  return value / quota.limit
}
export function calculateOracleStatus(input: {
  cost: OracleCostSummary
  quotas: readonly OracleQuotaUsage[]
  sources: readonly OracleSourceHealth[]
}): { status: OracleOverallStatus; message: string } {
  const usage = input.sources.find((source) => source.key === 'usage')
  const metadata = input.sources.find((source) => source.key === 'metadata')
  const inventory = input.sources.find((source) => source.key === 'inventory')

  if (usage?.state !== 'ok' || input.cost.actual === null) {
    return {
      status: 'unknown',
      message: 'OCI billing data is unavailable, so free-tier status cannot be confirmed.',
    }
  }

  if (input.cost.actual > CHARGE_TOLERANCE) {
    return {
      status: 'charge-detected',
      message: 'OCI reports a non-zero charge for the current UTC month.',
    }
  }

  if (metadata?.state !== 'ok' || inventory?.state !== 'ok') {
    return {
      status: 'unknown',
      message: 'Billing is available, but the current resource allocation could not be verified.',
    }
  }

  if (input.cost.hasRelevantUnmappedUsage) {
    return {
      status: 'unknown',
      message: 'OCI returned compute, storage, or network usage that this page could not classify.',
    }
  }

  const highestRatio = Math.max(
    0,
    ...input.quotas.map((quota) => quotaRatio(quota) ?? 0),
  )
  if (highestRatio >= NEAR_LIMIT_RATIO) {
    return {
      status: 'near-limit',
      message: 'At least one known allowance is projected to reach 85% this month.',
    }
  }
  if (highestRatio >= WATCH_RATIO) {
    return {
      status: 'watch',
      message: 'At least one known allowance is projected to reach 70% this month.',
    }
  }

  return {
    status: 'safe',
    message: 'OCI reports no charge and known usage remains below warning thresholds.',
  }
}
