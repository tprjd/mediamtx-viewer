import type { CSSProperties } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  CloudCog,
  ExternalLink,
  Gauge,
  HelpCircle,
  RefreshCw,
  Server,
  XCircle,
} from 'lucide-react'
import Link from 'next/link'
import styles from './statistics.module.css'

import { buttonVariants } from '@/components/ui/button'
import { requireActiveSession } from '@/lib/auth/session'
import { quotaRatio } from '@/lib/oracle-statistics-status'
import { getOracleStatistics } from '@/lib/oracle-statistics'
import type {
  OracleMetricRange,
  OracleMetricSeries,
  OracleOverallStatus,
  OracleSourceHealth,
} from '@/lib/oracle-statistics-types'

export const dynamic = 'force-dynamic'

interface StatisticsPageProps {
  searchParams: Promise<{ range?: string; refresh?: string }>
}

const statusLabels: Record<OracleOverallStatus, string> = {
  safe: 'Safe',
  watch: 'Watch',
  'near-limit': 'Near limit',
  'charge-detected': 'Charge detected',
  unknown: 'Unknown',
}

function parseRange(value: string | undefined): OracleMetricRange {
  return value === '1h' || value === '7d' ? value : '24h'
}

function formatDate(value: string): string {
  const formatted = new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))
  return `${formatted} UTC`
}

function formatNumber(value: number | null, maximumFractionDigits = 1): string {
  if (value === null || !Number.isFinite(value)) return 'Unavailable'
  return new Intl.NumberFormat('en', { maximumFractionDigits }).format(value)
}

function formatCurrency(value: number | null, currency: string | null): string {
  if (value === null) return 'Unavailable'
  if (!currency) return formatNumber(value, 4)
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      minimumFractionDigits: value === 0 ? 2 : 4,
      maximumFractionDigits: 4,
    }).format(value)
  } catch {
    return `${formatNumber(value, 4)} ${currency}`
  }
}

function formatBytes(value: number | null): string {
  if (value === null) return 'Unavailable'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = Math.max(0, value)
  let unit = 0
  while (amount >= 1_000 && unit < units.length - 1) {
    amount /= 1_000
    unit += 1
  }
  return `${formatNumber(amount, amount >= 10 ? 1 : 2)} ${units[unit]}`
}

function formatMetric(value: number | null, unit: OracleMetricSeries['unit']): string {
  if (unit === 'bytes') return formatBytes(value)
  if (value === null) return 'Unavailable'
  return `${formatNumber(value, 1)}${unit === '%' ? '%' : ''}`
}

function chartPoints(series: OracleMetricSeries): string {
  if (series.points.length < 2) return ''
  const values = series.points.map((point) => point.value)
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const spread = Math.max(maximum - minimum, 0.0001)
  return series.points
    .map((point, index) => {
      const x = (index / (series.points.length - 1)) * 100
      const y = 36 - ((point.value - minimum) / spread) * 32
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

function MetricChart({ series }: { series: OracleMetricSeries }) {
  const points = chartPoints(series)
  return (
    <article className={`${styles.oracleMetricCard}`}>
      <div className={`${styles.oracleMetricHeading}`}>
        <div>
          <p>{series.label}</p>
          <strong>{formatMetric(series.current, series.unit)}</strong>
        </div>
        <small>
          Avg {formatMetric(series.average, series.unit)} · Max{' '}
          {formatMetric(series.maximum, series.unit)}
        </small>
      </div>
      {points ? (
        <svg
          aria-label={`${series.label} history`}
          className={`${styles.oracleMetricChart}`}
          preserveAspectRatio="none"
          role="img"
          viewBox="0 0 100 40"
        >
          <path d="M0 36 H100" />
          <polyline points={points} />
        </svg>
      ) : (
        <div className={`${styles.oracleMetricEmpty}`}>No samples in this range</div>
      )}
    </article>
  )
}

function SourceIcon({ source }: { source: OracleSourceHealth }) {
  if (source.state === 'ok') return <CheckCircle2 aria-hidden="true" />
  if (source.state === 'error') return <XCircle aria-hidden="true" />
  return <HelpCircle aria-hidden="true" />
}

function OverallIcon({ status }: { status: OracleOverallStatus }) {
  if (status === 'safe') return <CheckCircle2 aria-hidden="true" />
  if (status === 'charge-detected') return <XCircle aria-hidden="true" />
  if (status === 'watch' || status === 'near-limit') {
    return <AlertTriangle aria-hidden="true" />
  }
  return <HelpCircle aria-hidden="true" />
}

export default async function StatisticsPage({ searchParams }: StatisticsPageProps) {
  await requireActiveSession()
  const params = await searchParams
  const range = parseRange(params.range)
  const statistics = await getOracleStatistics({
    range,
    force: typeof params.refresh === 'string',
  })

  return (
    <main className={`admin-layout ${styles.oracleStatisticsLayout}`}>
      <section className={`admin-heading ${styles.oracleHeading}`}>
        <div>
          <p className="eyebrow">Infrastructure</p>
          <h1>Oracle usage</h1>
          <p>Tenancy billing guardrails and live health for the streaming VM.</p>
        </div>
        <div className={`${styles.oracleHeadingActions}`}>
          <Link
            className={buttonVariants({ variant: 'secondary' })}
            href={`/statistics?range=${range}&refresh=${encodeURIComponent(statistics.generatedAt)}`}
            prefetch={false}
          >
            <RefreshCw className="size-4" aria-hidden="true" /> Refresh OCI
          </Link>
        </div>
      </section>

      <section
        className={`${styles.oracleOverall} ${
          statistics.status === 'safe'
            ? styles.oracleStatusSafe
            : statistics.status === 'watch'
              ? styles.oracleStatusWatch
              : statistics.status === 'near-limit'
                ? styles.oracleStatusNearLimit
                : statistics.status === 'charge-detected'
                  ? styles.oracleStatusChargeDetected
                  : ''
        }`}
      >
        <div className={`${styles.oracleOverallIcon}`}>
          <OverallIcon status={statistics.status} />
        </div>
        <div>
          <p className="eyebrow">Free-tier confidence</p>
          <h2>{statusLabels[statistics.status]}</h2>
          <p>{statistics.statusMessage}</p>
        </div>
        <small>Checked {formatDate(statistics.generatedAt)}</small>
      </section>

      {!statistics.enabled && (
        <p className={`${styles.oracleSetupNotice}`}>
          This local deployment has Oracle statistics disabled. The production Oracle Compose
          stack enables it through instance-principal authentication.
        </p>
      )}

      <section className={`${styles.oracleSummaryGrid}`} aria-label="Oracle usage summary">
        <article className={`${styles.oracleSummaryCard} ${styles.oracleCostCard}`}>
          <div className={`${styles.oracleCardLabel}`}>
            <CircleDollarSign aria-hidden="true" /> Current month cost
          </div>
          <strong>{formatCurrency(statistics.cost.actual, statistics.cost.currency)}</strong>
          <p>
            Forecast{' '}
            <span>{formatCurrency(statistics.cost.forecast, statistics.cost.currency)}</span>
          </p>
          <small>Tenancy-wide · month started {formatDate(statistics.monthStartedAt)}</small>
        </article>

        {statistics.quotas.map((quota) => {
          const ratio = quotaRatio(quota)
          const percentage = ratio === null ? null : Math.max(0, Math.min(ratio * 100, 100))
          return (
            <article className={`${styles.oracleSummaryCard}`} key={quota.key}>
              <div className={`${styles.oracleCardLabel}`}>
                <Gauge aria-hidden="true" /> {quota.label}
              </div>
              <strong>
                {formatNumber(quota.used)} <span>/ {formatNumber(quota.limit)}</span>
              </strong>
              <p>
                Projected <span>{formatNumber(quota.projected)} {quota.unit}</span>
              </p>
              <div
                aria-label={percentage === null ? 'Usage unavailable' : `${percentage.toFixed(1)}% projected`}
                className={`${styles.oracleQuotaTrack}`}
                role="progressbar"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={percentage ?? undefined}
                style={{ '--quota-progress': `${percentage ?? 0}%` } as CSSProperties}
              >
                <span />
              </div>
              <small>{quota.scope} · reference allowance</small>
            </article>
          )
        })}
      </section>

      <section className={`${styles.oracleSectionGrid}`}>
        <article className={`${styles.oraclePanel}`}>
          <div className={`${styles.oraclePanelHeading}`}>
            <div>
              <p className="eyebrow">Allocation</p>
              <h2>Viewer instance</h2>
            </div>
            <Server aria-hidden="true" />
          </div>
          {statistics.instance ? (
            <dl className={`${styles.oracleInstanceGrid}`}>
              <div><dt>Name</dt><dd>{statistics.instance.displayName}</dd></div>
              <div><dt>State</dt><dd>{statistics.instance.state}</dd></div>
              <div><dt>Shape</dt><dd>{statistics.instance.shape}</dd></div>
              <div><dt>OCPUs</dt><dd>{formatNumber(statistics.instance.ocpus)}</dd></div>
              <div><dt>Memory</dt><dd>{formatNumber(statistics.instance.memoryGb)} GB</dd></div>
              <div><dt>Boot volume</dt><dd>{formatNumber(statistics.instance.bootVolumeGb)} GB</dd></div>
              <div><dt>Region</dt><dd>{statistics.instance.region}</dd></div>
              <div><dt>Created</dt><dd>{statistics.instance.createdAt ? formatDate(statistics.instance.createdAt) : 'Unavailable'}</dd></div>
            </dl>
          ) : (
            <p className={`${styles.oraclePanelEmpty}`}>Compute inventory is unavailable.</p>
          )}
        </article>

        <article className={`${styles.oraclePanel}`}>
          <div className={`${styles.oraclePanelHeading}`}>
            <div>
              <p className="eyebrow">Diagnostics</p>
              <h2>Data sources</h2>
            </div>
            <CloudCog aria-hidden="true" />
          </div>
          <div className={`${styles.oracleSourceList}`}>
            {statistics.sources.map((source) => (
              <div
                className={`${styles.oracleSource} ${
                  source.state === 'ok'
                    ? styles.oracleSourceOk
                    : source.state === 'error'
                      ? styles.oracleSourceError
                      : ''
                }`}
                key={source.key}
              >
                <SourceIcon source={source} />
                <div>
                  <strong>{source.label}</strong>
                  <p>{source.message}</p>
                  <small>Checked {formatDate(source.checkedAt)}</small>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className={`${styles.oraclePanel} oracle-metrics-panel`}>
        <div className={`${styles.oraclePanelHeading} ${styles.oracleMetricsHeading}`}>
          <div>
            <p className="eyebrow">Operational only</p>
            <h2>VM health</h2>
            <p>Network charts are host telemetry, not the billable outbound-transfer total.</p>
          </div>
          <nav aria-label="Metric range" className={`${styles.oracleRangeSwitcher}`}>
            {(['1h', '24h', '7d'] as const).map((option) => (
              <Link
                aria-current={range === option ? 'page' : undefined}
                href={`/statistics?range=${option}`}
                key={option}
              >
                {option}
              </Link>
            ))}
          </nav>
        </div>
        {statistics.metrics.length > 0 ? (
          <div className={`${styles.oracleMetricsGrid}`}>
            {statistics.metrics.map((series) => <MetricChart key={series.key} series={series} />)}
          </div>
        ) : (
          <p className={`${styles.oraclePanelEmpty}`}>
            No compute metrics are available. Check the source diagnostics above.
          </p>
        )}
      </section>

      <section className={`${styles.oraclePanel}`}>
        <div className={`${styles.oraclePanelHeading}`}>
          <div>
            <p className="eyebrow">Authoritative billing feed</p>
            <h2>Cost and usage lines</h2>
          </div>
          <Activity aria-hidden="true" />
        </div>
        {statistics.cost.lines.length > 0 ? (
          <div className={`${styles.oracleTableScroll}`}>
            <table className={`${styles.oracleCostTable}`}>
              <thead>
                <tr><th>Service</th><th>SKU</th><th>Usage</th><th>Actual</th><th>Forecast</th></tr>
              </thead>
              <tbody>
                {statistics.cost.lines.map((line) => (
                  <tr key={`${line.service}-${line.sku}-${line.unit}`}>
                    <td>{line.service}</td>
                    <td>{line.sku}<small>{line.unit}</small></td>
                    <td>{formatNumber(line.usage, 3)}</td>
                    <td>{formatCurrency(line.actualCost, line.currency)}</td>
                    <td>{formatCurrency(line.forecastCost, line.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={`${styles.oraclePanelEmpty}`}>
            {statistics.cost.actual === 0
              ? 'OCI returned no cost lines for the current month.'
              : 'Cost lines are unavailable.'}
          </p>
        )}
      </section>

      <aside className={`${styles.oracleReferenceNote}`}>
        <div>
          <strong>Reference limits are not a billing guarantee.</strong>
          <p>
            Defaults follow Oracle&apos;s current A1 and Free Tier pages. OCI&apos;s tenancy-wide cost
            result is the final authority, and it can arrive after a reporting delay.
          </p>
        </div>
        <div className={`${styles.oracleReferenceLinks}`}>
          <a href="https://docs.oracle.com/en-us/iaas/Content/Compute/References/arm.htm" rel="noreferrer" target="_blank">
            A1 limits <ExternalLink aria-hidden="true" />
          </a>
          <a href="https://www.oracle.com/cloud/free/" rel="noreferrer" target="_blank">
            Free Tier <ExternalLink aria-hidden="true" />
          </a>
        </div>
      </aside>
    </main>
  )
}
