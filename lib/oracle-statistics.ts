import 'server-only'

import { readFile } from 'node:fs/promises'

import * as common from 'oci-common'
import * as core from 'oci-core'
import * as monitoring from 'oci-monitoring'
import * as usageapi from 'oci-usageapi'

import { calculateOracleStatus } from '@/lib/oracle-statistics-status'
import type {
  OracleCostLine,
  OracleCostSummary,
  OracleInstanceSummary,
  OracleMetricRange,
  OracleMetricSeries,
  OracleQuotaUsage,
  OracleSourceHealth,
  OracleStatistics,
} from '@/lib/oracle-statistics-types'

const IMDS_INSTANCE_URL = 'http://169.254.169.254/opc/v2/instance/'
const METADATA_TTL_MS = 5 * 60_000
const INVENTORY_TTL_MS = 5 * 60_000
const USAGE_TTL_MS = 60 * 60_000
const METRICS_TTL_MS = 60_000
const FAILURE_TTL_MS = 30_000

interface InstanceMetadata {
  id: string
  compartmentId: string
  tenancyId: string
  region: string
  availabilityDomain: string
  displayName: string
  shape: string
  state: string
  timeCreated: string | null
  ocpus: number | null
  memoryGb: number | null
}

interface CachedValue<T> {
  expiresAt: number
  promise: Promise<T>
}

interface SourceResult<T> {
  value: T | null
  health: OracleSourceHealth
}

interface InventoryResult {
  instance: OracleInstanceSummary
  attachedStorageGb: number
}

interface UsageResult {
  cost: OracleCostSummary
  usageByQuota: Partial<Record<OracleQuotaUsage['key'], number>>
  projectedByQuota: Partial<Record<OracleQuotaUsage['key'], number>>
}

interface OciClients {
  compute: core.ComputeClient
  block: core.BlockstorageClient
  monitoring: monitoring.MonitoringClient
}

const cache = new Map<string, CachedValue<unknown>>()
const cacheFetchedAt = new Map<string, string>()
let providerPromise: Promise<common.AuthenticationDetailsProvider> | undefined
let clientsPromise: Promise<OciClients> | undefined
let usageClientPromise: Promise<usageapi.UsageapiClient> | undefined

function positiveNumber(name: string, fallback: number): number {
  const configured = Number(process.env[name])
  return Number.isFinite(configured) && configured > 0 ? configured : fallback
}

function referenceLimits() {
  return {
    ocpu: positiveNumber('OCI_FREE_A1_OCPU_HOURS', 3_000),
    memory: positiveNumber('OCI_FREE_A1_MEMORY_GB_HOURS', 18_000),
    storage: positiveNumber('OCI_FREE_BLOCK_STORAGE_GB', 200),
    outbound: positiveNumber('OCI_FREE_OUTBOUND_GB', 10_000),
  }
}

async function cached<T>(
  key: string,
  ttlMs: number,
  force: boolean,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now()
  const existing = cache.get(key) as CachedValue<T> | undefined
  if (!force && existing && existing.expiresAt > now) return existing.promise

  const promise = loader()
    .then((value) => {
      cacheFetchedAt.set(key, checkedAt())
      return value
    })
    .catch((error) => {
      const failedEntry = cache.get(key)
      if (failedEntry?.promise === promise) {
        failedEntry.expiresAt = Date.now() + FAILURE_TTL_MS
      }
      throw error
    })
  cache.set(key, { expiresAt: now + ttlMs, promise })
  return promise
}

function checkedAt(): string {
  return new Date().toISOString()
}

function sourceHealth(
  key: OracleSourceHealth['key'],
  label: string,
  state: OracleSourceHealth['state'],
  message: string,
  sourceCheckedAt = checkedAt(),
): OracleSourceHealth {
  return { key, label, state, checkedAt: sourceCheckedAt, message }
}

function errorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const value = (error as { statusCode?: unknown }).statusCode
  return typeof value === 'number' ? value : null
}

function safeErrorMessage(error: unknown, subject: string): string {
  const status = errorStatus(error)
  if (status === 401 || status === 403) {
    return `${subject} permission is missing from the OCI IAM policy.`
  }
  if (status === 404) {
    return `${subject} was not found or the OCI identity is not authorized.`
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `${subject} timed out.`
  }
  return `${subject} could not be queried.`
}

function ociDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

async function getMetadata(force: boolean): Promise<SourceResult<InstanceMetadata>> {
  if (process.env.OCI_STATS_ENABLED !== 'true') {
    return {
      value: null,
      health: sourceHealth(
        'metadata',
        'Instance metadata',
        'unavailable',
        'Oracle statistics are disabled. Set OCI_STATS_ENABLED=true on the OCI VM.',
      ),
    }
  }

  try {
    const metadata = await cached('oci-metadata', METADATA_TTL_MS, force, async () => {
      const response = await fetch(IMDS_INSTANCE_URL, {
        headers: { Authorization: 'Bearer Oracle' },
        cache: 'no-store',
        signal: AbortSignal.timeout(4_000),
      })
      if (!response.ok) {
        throw Object.assign(new Error('IMDS request failed'), {
          statusCode: response.status,
        })
      }
      const raw = (await response.json()) as Record<string, unknown>
      const shapeConfig = (raw.shapeConfig ?? {}) as Record<string, unknown>
      const id = String(raw.id ?? process.env.OCI_INSTANCE_OCID ?? '')
      const compartmentId = String(
        raw.compartmentId ?? process.env.OCI_COMPARTMENT_OCID ?? '',
      )
      const tenancyId = String(
        raw.tenantId ?? raw.tenancyId ?? process.env.OCI_TENANCY_OCID ?? '',
      )
      const region = String(
        raw.canonicalRegionName ?? raw.region ?? process.env.OCI_REGION ?? '',
      )
      if (!id || !compartmentId || !tenancyId || !region) {
        throw new Error('IMDS identity is incomplete')
      }
      return {
        id,
        compartmentId,
        tenancyId,
        region,
        availabilityDomain: String(raw.availabilityDomain ?? ''),
        displayName: String(raw.displayName ?? raw.hostname ?? 'MediaMTX viewer'),
        shape: String(raw.shape ?? 'Unknown'),
        state: String(raw.state ?? 'Running'),
        timeCreated: typeof raw.timeCreated === 'string' ? raw.timeCreated : null,
        ocpus: typeof shapeConfig.ocpus === 'number' ? shapeConfig.ocpus : null,
        memoryGb:
          typeof shapeConfig.memoryInGBs === 'number'
            ? shapeConfig.memoryInGBs
            : null,
      } satisfies InstanceMetadata
    })
    return {
      value: metadata,
      health: sourceHealth(
        'metadata',
        'Instance metadata',
        'ok',
        'OCI Instance Metadata Service v2 responded.',
        cacheFetchedAt.get('oci-metadata'),
      ),
    }
  } catch (error) {
    return {
      value: null,
      health: sourceHealth(
        'metadata',
        'Instance metadata',
        'error',
        safeErrorMessage(error, 'Instance metadata'),
      ),
    }
  }
}

async function authenticationProvider(
  metadata: InstanceMetadata,
): Promise<common.AuthenticationDetailsProvider> {
  if (!providerPromise) {
    providerPromise = (async () => {
      const tenancy = process.env.OCI_USAGE_TENANCY_OCID
      const user = process.env.OCI_USAGE_USER_OCID
      const fingerprint = process.env.OCI_USAGE_FINGERPRINT
      const privateKeyPath = process.env.OCI_USAGE_PRIVATE_KEY_PATH

      if (tenancy && user && fingerprint && privateKeyPath) {
        return new common.SimpleAuthenticationDetailsProvider(
          tenancy,
          user,
          fingerprint,
          await readFile(privateKeyPath, 'utf8'),
          null,
          common.Region.fromRegionId(metadata.region),
        )
      }
      return new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build()
    })().catch((error) => {
        providerPromise = undefined
        throw error
      })
  }
  return providerPromise
}

async function getClients(metadata: InstanceMetadata): Promise<OciClients> {
  if (!clientsPromise) {
    clientsPromise = authenticationProvider(metadata)
      .then((authenticationDetailsProvider) => {
        const params = { authenticationDetailsProvider }
        const clients: OciClients = {
          compute: new core.ComputeClient(params),
          block: new core.BlockstorageClient(params),
          monitoring: new monitoring.MonitoringClient(params),
        }
        for (const client of Object.values(clients)) client.regionId = metadata.region
        return clients
      })
      .catch((error) => {
        clientsPromise = undefined
        throw error
      })
  }
  return clientsPromise
}

async function getUsageClient(
  metadata: InstanceMetadata,
): Promise<usageapi.UsageapiClient> {
  if (!usageClientPromise) {
    usageClientPromise = (async () => {
      const authenticationDetailsProvider = await authenticationProvider(metadata)
      const client = new usageapi.UsageapiClient({ authenticationDetailsProvider })
      client.regionId = metadata.region
      return client
    })().catch((error) => {
      usageClientPromise = undefined
      throw error
    })
  }
  return usageClientPromise
}

async function getInventory(
  metadata: InstanceMetadata | null,
  force: boolean,
): Promise<SourceResult<InventoryResult>> {
  if (!metadata) {
    return {
      value: null,
      health: sourceHealth(
        'inventory',
        'Compute inventory',
        'unavailable',
        'Instance identity is required before querying compute inventory.',
      ),
    }
  }

  try {
    const inventory = await cached('oci-inventory', INVENTORY_TTL_MS, force, async () => {
      const clients = await getClients(metadata)
      const instanceResponse = await clients.compute.getInstance({ instanceId: metadata.id })
      const instance = instanceResponse.instance
      const [bootAttachments, volumeAttachments] = await Promise.all([
        clients.compute.listBootVolumeAttachments({
          availabilityDomain: instance.availabilityDomain,
          compartmentId: metadata.compartmentId,
          instanceId: metadata.id,
        }),
        clients.compute.listVolumeAttachments({
          compartmentId: metadata.compartmentId,
          instanceId: metadata.id,
        }),
      ])
      const [bootVolumes, volumes] = await Promise.all([
        Promise.all(
          bootAttachments.items
            .filter((attachment) => attachment.lifecycleState === 'ATTACHED')
            .map((attachment) =>
              clients.block.getBootVolume({ bootVolumeId: attachment.bootVolumeId }),
            ),
        ),
        Promise.all(
          volumeAttachments.items
            .filter((attachment) => attachment.lifecycleState === 'ATTACHED')
            .map((attachment) => clients.block.getVolume({ volumeId: attachment.volumeId })),
        ),
      ])
      const bootVolumeGb = bootVolumes.reduce(
        (total, response) => total + (response.bootVolume.sizeInGBs ?? 0),
        0,
      )
      const blockVolumeGb = volumes.reduce(
        (total, response) => total + (response.volume.sizeInGBs ?? 0),
        0,
      )
      return {
        attachedStorageGb: bootVolumeGb + blockVolumeGb,
        instance: {
          displayName: instance.displayName ?? metadata.displayName,
          state: instance.lifecycleState,
          shape: instance.shape,
          ocpus: instance.shapeConfig?.ocpus ?? metadata.ocpus,
          memoryGb: instance.shapeConfig?.memoryInGBs ?? metadata.memoryGb,
          bootVolumeGb,
          region: instance.region || metadata.region,
          availabilityDomain: instance.availabilityDomain,
          createdAt: ociDate(instance.timeCreated)?.toISOString() ?? metadata.timeCreated,
        },
      } satisfies InventoryResult
    })
    return {
      value: inventory,
      health: sourceHealth(
        'inventory',
        'Compute inventory',
        'ok',
        'Current instance and attached volume allocation loaded from OCI.',
        cacheFetchedAt.get('oci-inventory'),
      ),
    }
  } catch (error) {
    return {
      value: null,
      health: sourceHealth(
        'inventory',
        'Compute inventory',
        'error',
        safeErrorMessage(error, 'Compute inventory'),
      ),
    }
  }
}

function monthBounds(now = new Date()): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  }
}

function numericUsage(item: usageapi.models.UsageSummary): number {
  if (typeof item.computedQuantity === 'number') return item.computedQuantity
  const attributed = Number(item.attributedUsage)
  return Number.isFinite(attributed) ? attributed : 0
}

function numericCost(item: usageapi.models.UsageSummary): number {
  if (typeof item.computedAmount === 'number') return item.computedAmount
  const attributed = Number(item.attributedCost)
  return Number.isFinite(attributed) ? attributed : 0
}

function classifyUsage(
  item: usageapi.models.UsageSummary,
): OracleQuotaUsage['key'] | null {
  const description = `${item.service ?? ''} ${item.skuName ?? ''} ${item.shape ?? ''}`.toLowerCase()
  const unit = (item.unit ?? '').toLowerCase()
  const isAmpere = /\b(?:ampere|a1)\b/.test(description)

  if (isAmpere && (description.includes('ocpu') || unit.includes('ocpu'))) return 'ocpu'
  if (isAmpere && description.includes('memory') && unit.includes('hour')) return 'memory'
  if (
    description.includes('block volume') &&
    (unit.includes('gigabyte') || unit.includes('gb'))
  ) {
    return 'storage'
  }
  if (
    (description.includes('outbound') || description.includes('data transfer')) &&
    !description.includes('inbound') &&
    (unit.includes('gigabyte') || unit.includes('gb'))
  ) {
    return 'outbound'
  }
  return null
}

function isRelevantUsage(item: usageapi.models.UsageSummary): boolean {
  const description = `${item.service ?? ''} ${item.skuName ?? ''}`.toLowerCase()
  return ['compute', 'block volume', 'network', 'data transfer'].some((word) =>
    description.includes(word),
  )
}

function summarizeUsage(items: usageapi.models.UsageSummary[]): UsageResult {
  const usageByQuota: UsageResult['usageByQuota'] = {}
  const forecastByQuota: UsageResult['projectedByQuota'] = {}
  const groupedLines = new Map<string, OracleCostLine>()
  let actualCost = 0
  let futureCost = 0
  let currency: string | null = null
  let hasForecast = false
  let hasRelevantUnmappedUsage = false

  for (const item of items) {
    const quantity = numericUsage(item)
    const amount = numericCost(item)
    const quota = classifyUsage(item)
    const forecast = item.isForecast === true
    if (forecast) {
      hasForecast = true
      futureCost += amount
      if (quota) forecastByQuota[quota] = (forecastByQuota[quota] ?? 0) + quantity
    } else {
      actualCost += amount
      if (quota) usageByQuota[quota] = (usageByQuota[quota] ?? 0) + quantity
      if (!quota && quantity > 0 && isRelevantUsage(item)) {
        hasRelevantUnmappedUsage = true
      }
    }
    currency ??= item.currency ?? null

    const service = item.service?.trim() || 'Unknown service'
    const sku = item.skuName?.trim() || item.skuPartNumber?.trim() || 'Unknown SKU'
    const unit = item.unit?.trim() || '—'
    const key = `${service}\u0000${sku}\u0000${unit}\u0000${item.currency ?? ''}`
    const line = groupedLines.get(key) ?? {
      service,
      sku,
      unit,
      usage: null,
      actualCost: 0,
      forecastCost: 0,
      currency: item.currency ?? null,
    }
    if (forecast) {
      line.forecastCost += amount
    } else {
      line.actualCost += amount
      line.usage = (line.usage ?? 0) + quantity
    }
    groupedLines.set(key, line)
  }

  const projectedByQuota: UsageResult['projectedByQuota'] = {}
  for (const key of ['ocpu', 'memory', 'storage', 'outbound'] as const) {
    if (forecastByQuota[key] !== undefined) {
      projectedByQuota[key] = (usageByQuota[key] ?? 0) + forecastByQuota[key]!
    }
  }

  const lines = [...groupedLines.values()]
    .map((line) => ({
      ...line,
      forecastCost: line.actualCost + line.forecastCost,
    }))
    .sort((left, right) => right.actualCost - left.actualCost || left.service.localeCompare(right.service))

  return {
    cost: {
      actual: actualCost,
      forecast: hasForecast ? actualCost + futureCost : null,
      currency,
      lines,
      hasRelevantUnmappedUsage,
    },
    usageByQuota,
    projectedByQuota,
  }
}

async function getUsage(
  metadata: InstanceMetadata | null,
  force: boolean,
): Promise<SourceResult<UsageResult>> {
  if (!metadata) {
    return {
      value: null,
      health: sourceHealth(
        'usage',
        'Tenancy billing',
        'unavailable',
        'Instance identity is required before querying tenancy-wide usage.',
      ),
    }
  }

  try {
    const result = await cached('oci-usage', USAGE_TTL_MS, force, async () => {
      const client = await getUsageClient(metadata)
      const now = new Date()
      const bounds = monthBounds(now)
      const items: usageapi.models.UsageSummary[] = []
      let page: string | undefined
      do {
        const response = await client.requestSummarizedUsages({
          page,
          limit: 500,
          requestSummarizedUsagesDetails: {
            tenantId: metadata.tenancyId,
            timeUsageStarted: bounds.start,
            timeUsageEnded: bounds.end,
            granularity: usageapi.models.RequestSummarizedUsagesDetails.Granularity.Monthly,
            queryType: usageapi.models.RequestSummarizedUsagesDetails.QueryType.Cost,
            isAggregateByTime: true,
            groupBy: ['service', 'skuName', 'skuPartNumber', 'unit'],
          },
        })
        items.push(...response.usageAggregation.items)
        page = response.opcNextPage || undefined
      } while (page)
      return summarizeUsage(items)
    })
    return {
      value: result,
      health: sourceHealth(
        'usage',
        'Tenancy billing',
        'ok',
        'Current UTC month loaded from the tenancy-wide OCI Usage API.',
        cacheFetchedAt.get('oci-usage'),
      ),
    }
  } catch (error) {
    return {
      value: null,
      health: sourceHealth(
        'usage',
        'Tenancy billing',
        'error',
        safeErrorMessage(error, 'Usage API'),
      ),
    }
  }
}

const metricDefinitions = [
  { key: 'cpu', name: 'CpuUtilization', label: 'CPU', unit: '%' as const, statistic: 'mean' },
  { key: 'memory', name: 'MemoryUtilization', label: 'Memory', unit: '%' as const, statistic: 'mean' },
  { key: 'load', name: 'LoadAverage', label: 'Load average', unit: 'load' as const, statistic: 'mean' },
  { key: 'network-in', name: 'NetworksBytesIn', label: 'Network received', unit: 'bytes' as const, statistic: 'sum' },
  { key: 'network-out', name: 'NetworksBytesOut', label: 'Network sent', unit: 'bytes' as const, statistic: 'sum' },
  { key: 'disk-read', name: 'DiskBytesRead', label: 'Disk read', unit: 'bytes' as const, statistic: 'sum' },
  { key: 'disk-write', name: 'DiskBytesWritten', label: 'Disk written', unit: 'bytes' as const, statistic: 'sum' },
] as const

function rangeSettings(range: OracleMetricRange): { milliseconds: number; interval: string } {
  if (range === '1h') return { milliseconds: 60 * 60_000, interval: '1m' }
  if (range === '7d') return { milliseconds: 7 * 24 * 60 * 60_000, interval: '1h' }
  return { milliseconds: 24 * 60 * 60_000, interval: '5m' }
}

async function getMetrics(
  metadata: InstanceMetadata | null,
  range: OracleMetricRange,
  force: boolean,
): Promise<SourceResult<OracleMetricSeries[]>> {
  if (!metadata) {
    return {
      value: null,
      health: sourceHealth(
        'monitoring',
        'Compute monitoring',
        'unavailable',
        'Instance identity is required before querying compute metrics.',
      ),
    }
  }

  try {
    const metrics = await cached(`oci-metrics-${range}`, METRICS_TTL_MS, force, async () => {
      const client = (await getClients(metadata)).monitoring
      const settings = rangeSettings(range)
      const endTime = new Date()
      const startTime = new Date(endTime.getTime() - settings.milliseconds)
      const results = await Promise.allSettled(
        metricDefinitions.map(async (definition): Promise<OracleMetricSeries> => {
          const response = await client.summarizeMetricsData({
            compartmentId: metadata.compartmentId,
            summarizeMetricsDataDetails: {
              namespace: 'oci_computeagent',
              query: `${definition.name}[${settings.interval}]{resourceId = "${metadata.id}"}.${definition.statistic}()`,
              startTime,
              endTime,
              resolution: settings.interval,
            },
          })
          const points = response.items
            .flatMap((stream) => stream.aggregatedDatapoints)
            .map((point) => ({ timestamp: ociDate(point.timestamp), value: point.value }))
            .filter(
              (point): point is { timestamp: Date; value: number } =>
                point.timestamp !== null,
            )
            .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
            .map((point) => ({ timestamp: point.timestamp.toISOString(), value: point.value }))
          const values = points.map((point) => point.value)
          return {
            key: definition.key,
            label: definition.label,
            unit: definition.unit,
            points,
            current: values.at(-1) ?? null,
            average:
              values.length > 0
                ? values.reduce((sum, value) => sum + value, 0) / values.length
                : null,
            maximum: values.length > 0 ? Math.max(...values) : null,
          }
        }),
      )
      const fulfilled = results
        .filter((result): result is PromiseFulfilledResult<OracleMetricSeries> => result.status === 'fulfilled')
        .map((result) => result.value)
      if (fulfilled.length === 0) {
        const rejected = results.find((result) => result.status === 'rejected')
        if (rejected?.status === 'rejected') throw rejected.reason
      }
      return fulfilled
    })

    const populated = metrics.filter((series) => series.points.length > 0).length
    return {
      value: metrics,
      health: sourceHealth(
        'monitoring',
        'Compute monitoring',
        populated > 0 ? 'ok' : 'unavailable',
        populated > 0
          ? `${populated} of ${metricDefinitions.length} metric series contain data.`
          : 'No compute-agent data was returned. Check Oracle Cloud Agent and its monitoring plugin.',
        cacheFetchedAt.get(`oci-metrics-${range}`),
      ),
    }
  } catch (error) {
    return {
      value: null,
      health: sourceHealth(
        'monitoring',
        'Compute monitoring',
        'error',
        safeErrorMessage(error, 'Monitoring API'),
      ),
    }
  }
}

function emptyCost(): OracleCostSummary {
  return {
    actual: null,
    forecast: null,
    currency: null,
    lines: [],
    hasRelevantUnmappedUsage: false,
  }
}

function buildQuotas(
  usage: UsageResult | null,
  inventory: InventoryResult | null,
): OracleQuotaUsage[] {
  const limits = referenceLimits()
  const now = new Date()
  const bounds = monthBounds(now)
  const elapsed = Math.max(1, now.getTime() - bounds.start.getTime())
  const projectionFactor = (bounds.end.getTime() - bounds.start.getTime()) / elapsed
  const elapsedHours = elapsed / 3_600_000
  const monthHours = (bounds.end.getTime() - bounds.start.getTime()) / 3_600_000

  const allocationUsage = (
    key: OracleQuotaUsage['key'],
    hours: number,
  ): number | null => {
    if (!inventory) return null
    if (key === 'ocpu' && inventory.instance.ocpus !== null) {
      return inventory.instance.ocpus * hours
    }
    if (key === 'memory' && inventory.instance.memoryGb !== null) {
      return inventory.instance.memoryGb * hours
    }
    return null
  }

  const value = (key: OracleQuotaUsage['key']): number | null => {
    const observed = usage?.usageByQuota[key]
    if (key === 'storage' && inventory) {
      return Math.max(observed ?? 0, inventory.attachedStorageGb)
    }
    return observed ?? (usage ? 0 : allocationUsage(key, elapsedHours))
  }
  const projected = (key: OracleQuotaUsage['key']): number | null => {
    const used = value(key)
    if (used === null) return null
    if (key === 'storage') return used
    if (!usage) return allocationUsage(key, monthHours)
    return usage?.projectedByQuota[key] ?? used * projectionFactor
  }

  const computeScope = usage ? 'Tenancy usage' : 'At least this VM allocation'

  return [
    { key: 'ocpu', label: 'A1 compute', used: value('ocpu'), projected: projected('ocpu'), limit: limits.ocpu, unit: 'OCPU-hours', scope: computeScope },
    { key: 'memory', label: 'A1 memory', used: value('memory'), projected: projected('memory'), limit: limits.memory, unit: 'GB-hours', scope: computeScope },
    { key: 'storage', label: 'Block storage', used: value('storage'), projected: projected('storage'), limit: limits.storage, unit: 'GB', scope: 'At least this VM allocation' },
    { key: 'outbound', label: 'Outbound transfer', used: value('outbound'), projected: projected('outbound'), limit: limits.outbound, unit: 'GB', scope: 'Tenancy usage' },
  ]
}

export async function getOracleStatistics(options: {
  range: OracleMetricRange
  force?: boolean
}): Promise<OracleStatistics> {
  const force = options.force === true
  const metadata = await getMetadata(force)
  const [inventory, usage, metrics] = await Promise.all([
    getInventory(metadata.value, force),
    getUsage(metadata.value, force),
    getMetrics(metadata.value, options.range, force),
  ])
  const cost = usage.value?.cost ?? emptyCost()
  const quotas = buildQuotas(usage.value, inventory.value)
  const sources = [metadata.health, usage.health, inventory.health, metrics.health]
  const overall = calculateOracleStatus({ cost, quotas, sources })

  return {
    enabled: process.env.OCI_STATS_ENABLED === 'true',
    status: overall.status,
    statusMessage: overall.message,
    generatedAt: checkedAt(),
    monthStartedAt: monthBounds().start.toISOString(),
    range: options.range,
    cost,
    quotas,
    instance: inventory.value?.instance ?? null,
    metrics: metrics.value ?? [],
    sources,
  }
}
