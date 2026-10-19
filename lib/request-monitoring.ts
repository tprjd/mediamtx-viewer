import { createServer } from 'node:http'
import { isIP } from 'node:net'
import { SpanKind, SpanStatusCode, trace, TraceFlags, type Attributes } from '@opentelemetry/api'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { BatchSpanProcessor, SamplingDecision, TraceIdRatioBasedSampler, type ReadableSpan, type SpanProcessor } from '@opentelemetry/sdk-trace'
import { MeterProvider, AggregationType, InstrumentType, createAllowListAttributesProcessor } from '@opentelemetry/sdk-metrics'
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { APP_VERSION } from './app-version'
import { databaseOperations, monitoringMethod, monitoringRoute } from './monitoring-labels'

// Project attributes into a new object before the SDK queue sees a span.
function safeSpan(span: ReadableSpan, resource: ReadableSpan['resource']): ReadableSpan | undefined {
  const native = span.instrumentationScope.name === 'next.js'
  const operation = span.attributes['db.operation.name']
  const database = span.instrumentationScope.name === 'mediamtx-viewer' && databaseOperations.some(value => value === operation)
  if (!native && !database) return
  const root = span.attributes['next.span_type'] === 'BaseServer.handleRequest'
  const route = monitoringRoute(span.attributes['http.route'] ?? span.attributes['next.route'])
  const method = monitoringMethod(span.attributes['http.method'])
  const status = Number(span.attributes['http.status_code'])
  const attributes: Attributes = database ? { 'db.operation.name': operation } : {
    'http.route': route, 'http.request.method': method,
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { 'http.response.status_code': status } : {}),
  }
  return {
    name: database ? `database ${operation}` : root ? `${method} ${route}` : 'next operation',
    kind: database ? SpanKind.INTERNAL : root ? SpanKind.SERVER : SpanKind.INTERNAL,
    spanContext: () => ({ traceId: span.spanContext().traceId, spanId: span.spanContext().spanId, traceFlags: span.spanContext().traceFlags }),
    parentSpanContext: span.parentSpanContext ? { traceId: span.parentSpanContext.traceId, spanId: span.parentSpanContext.spanId, traceFlags: span.parentSpanContext.traceFlags } : undefined,
    startTime: span.startTime, endTime: span.endTime, duration: span.duration, ended: true,
    status: { code: span.status.code }, attributes, links: [], events: [], resource,
    instrumentationScope: { name: 'mediamtx-viewer' },
    droppedAttributesCount: 0, droppedEventsCount: 0, droppedLinksCount: 0,
  }
}

export async function startRequestMonitoring({
  endpoint = 'http://127.0.0.1:4318/v1/traces', metricsHost = '127.0.0.1', metricsPort = 9464,
  sampleRatio = 0.1, log = (line: string) => console.error(line),
} = {}) {
  const destination = new URL(endpoint)
  const privateAddress = destination.hostname === '127.0.0.1' || isIP(destination.hostname) === 4 && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(destination.hostname)
  if (destination.protocol !== 'http:' || !privateAddress || destination.username || destination.password || destination.search || destination.pathname !== '/v1/traces') throw new Error('Trace destination must be the private collector')
  const resource = resourceFromAttributes({ 'service.name': 'mediamtx-viewer', 'service.version': APP_VERSION })
  const reader = new PrometheusExporter({ preventServerStart: true, withoutScopeInfo: true, withoutTargetInfo: true })
  const meters = new MeterProvider({ resource, readers: [reader], views: [
    { meterName: 'mediamtx-viewer', instrumentType: InstrumentType.HISTOGRAM, aggregationCardinalityLimit: 128, aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: [0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10] } } },
    { meterName: 'mediamtx-viewer', instrumentType: InstrumentType.COUNTER, aggregationCardinalityLimit: 128 },
    { instrumentName: 'otel.*', attributesProcessors: [createAllowListAttributesProcessor(['error.type'])], aggregationCardinalityLimit: 8 },
  ] })
  const meter = meters.getMeter('mediamtx-viewer')
  const requests = meter.createCounter('monitoring_request_total')
  const errors = meter.createCounter('monitoring_request_errors_total')
  const duration = meter.createHistogram('monitoring_request_duration_seconds')
  const dbDuration = meter.createHistogram('monitoring_database_duration_seconds')
  const dropped = meter.createCounter('monitoring_trace_dropped_total')
  const droppedLogs = meter.createCounter('monitoring_request_log_dropped_total')
  dropped.add(0, { reason: 'volume' }); droppedLogs.add(0)
  meter.createObservableGauge('monitoring_trace_sample_ratio').addCallback(result => result.observe(sampleRatio))
  const exporter = new OTLPTraceExporter({ url: endpoint, timeoutMillis: 2000, concurrencyLimit: 1, headers: {} })
  const batches = new BatchSpanProcessor({ exporter, maxQueueSize: 128, maxExportBatchSize: 32, scheduledDelayMillis: 1000, exportTimeoutMillis: 2500, selfObsMeterProvider: meters })
  let windowStart = Date.now(), spanCount = 0, logCount = 0
  const processor: SpanProcessor = {
    onStart() {},
    onEnd(span) {
      const safe = safeSpan(span, resource)
      if (!safe) return
      const seconds = span.duration[0] + span.duration[1] / 1e9
      const sampled = (span.spanContext().traceFlags & TraceFlags.SAMPLED) !== 0
      if (Date.now() - windowStart >= 15000) { windowStart = Date.now(); spanCount = 0; logCount = 0 }
      if (span.attributes['next.span_type'] === 'BaseServer.handleRequest') {
        const labels = { route: safe.attributes['http.route'], method: safe.attributes['http.request.method'] }
        const status = Number(safe.attributes['http.response.status_code'])
        requests.add(1, labels); duration.record(seconds, labels)
        if (status >= 400 || span.status.code === SpanStatusCode.ERROR) {
          errors.add(1, { ...labels, status_class: status >= 400 && status < 500 ? '4xx' : '5xx' })
          if (status >= 500 || span.status.code === SpanStatusCode.ERROR) {
            if (logCount++ < 8) log(JSON.stringify({ event: 'request_error', level: 'error', message: 'Application request failed', ...labels, status: status >= 100 && status <= 599 ? status : 500, ...(sampled ? { traceId: span.spanContext().traceId } : {}) }))
            else droppedLogs.add(1)
          }
        }
      }
      if (safe.attributes['db.operation.name']) dbDuration.record(seconds, { operation: safe.attributes['db.operation.name'] })
      if (sampled) {
        if (spanCount++ < 64) batches.onEnd(safe)
        else dropped.add(1, { reason: 'volume' })
      }
    },
    forceFlush: () => batches.forceFlush(), shutdown: () => batches.shutdown(),
  }
  const ratio = new TraceIdRatioBasedSampler(sampleRatio)
  const provider = new NodeTracerProvider({ resource, spanProcessors: [processor],
    spanLimits: { attributeCountLimit: 32, attributeValueLengthLimit: 256, eventCountLimit: 0, linkCountLimit: 0 },
    sampler: {
      shouldSample(parentContext, traceId) {
        const parent = trace.getSpanContext(parentContext)
        const sampled = parent && !parent.isRemote ? (parent.traceFlags & TraceFlags.SAMPLED) !== 0 : ratio.shouldSample(parentContext, traceId).decision === SamplingDecision.RECORD_AND_SAMPLED
        return { decision: sampled ? SamplingDecision.RECORD_AND_SAMPLED : SamplingDecision.RECORD }
      },
      toString: () => 'BoundedRequestSampler',
    },
  })
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/metrics') { response.writeHead(404).end(); return }
    reader.getMetricsRequestHandler(request, response)
  })
  server.maxConnections = 4; server.requestTimeout = 3000; server.headersTimeout = 3000
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(metricsPort, metricsHost, resolve) })
  } catch (error) { await provider.shutdown(); await meters.shutdown(); throw error }
  // Public traceparent and baggage cannot select sampling or carry private values.
  provider.register({ propagator: { inject() {}, extract: context => context, fields: () => [] } })
  server.unref()
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing metrics address')
  return {
    metricsUrl: `http://${metricsHost}:${address.port}/metrics`,
    flush: () => provider.forceFlush(),
    stop: async () => {
      await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
      try { await provider.shutdown() } finally { await meters.shutdown() }
    },
  }
}
