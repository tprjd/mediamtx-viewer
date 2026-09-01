export type OracleOverallStatus =
  | 'safe'
  | 'watch'
  | 'near-limit'
  | 'charge-detected'
  | 'unknown'

export type OracleSourceState = 'ok' | 'unavailable' | 'error'
export type OracleMetricRange = '1h' | '24h' | '7d'

export interface OracleSourceHealth {
  key: 'metadata' | 'usage' | 'inventory' | 'monitoring'
  label: string
  state: OracleSourceState
  checkedAt: string
  message: string
}
export interface OracleQuotaUsage {
  key: 'ocpu' | 'memory' | 'storage' | 'outbound'
  label: string
  used: number | null
  projected: number | null
  limit: number
  unit: string
  scope: string
}

export interface OracleCostLine {
  service: string
  sku: string
  unit: string
  usage: number | null
  actualCost: number
  forecastCost: number
  currency: string | null
}

export interface OracleCostSummary {
  actual: number | null
  forecast: number | null
  currency: string | null
  lines: OracleCostLine[]
  hasRelevantUnmappedUsage: boolean
}

export interface OracleInstanceSummary {
  displayName: string
  state: string
  shape: string
  ocpus: number | null
  memoryGb: number | null
  bootVolumeGb: number | null
  region: string
  availabilityDomain: string
  createdAt: string | null
}

export interface OracleMetricPoint {
  timestamp: string
  value: number
}

export interface OracleMetricSeries {
  key: string
  label: string
  unit: '%' | 'load' | 'bytes'
  points: OracleMetricPoint[]
  current: number | null
  average: number | null
  maximum: number | null
}

export interface OracleStatistics {
  enabled: boolean
  status: OracleOverallStatus
  statusMessage: string
  generatedAt: string
  monthStartedAt: string
  range: OracleMetricRange
  cost: OracleCostSummary
  quotas: OracleQuotaUsage[]
  instance: OracleInstanceSummary | null
  metrics: OracleMetricSeries[]
  sources: OracleSourceHealth[]
}
