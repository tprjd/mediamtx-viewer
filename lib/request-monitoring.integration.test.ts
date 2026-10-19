// @vitest-environment node
import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { context, propagation, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { startRequestMonitoring } from './request-monitoring'

vi.mock('server-only', () => ({}))
const database = new Database(':memory:')
vi.mock('@/lib/auth/database', () => ({ getDatabase: () => database }))
for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) database.exec(readFileSync(`migrations/${name}`, 'utf8'))
database.prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, activationStatus) VALUES (?, ?, ?, 1, 0, 0, 'active')").run('private-account', 'Private Name', 'private@example.test')
afterAll(() => database.close())
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  trace.disable(); context.disable(); propagation.disable(); vi.restoreAllMocks()
})

it('bounds telemetry during an outage without waiting for export in request handling', async () => {
  const sink = await listen(createServer(() => { /* Simulate a stalled collector. */ }))
  const logs: string[] = []
  const monitoring = await startRequestMonitoring({ endpoint: `${sink}/v1/traces`, metricsHost: '127.0.0.1', metricsPort: 0, sampleRatio: 1, log: line => logs.push(line) })
  cleanup.push(monitoring.stop)
  const tracer = trace.getTracer('next.js')
  const started = performance.now()
  for (let index = 0; index < 1000; index++) {
    const span = tracer.startSpan('PRIVATE_URL', { attributes: { 'next.span_type': 'BaseServer.handleRequest', 'http.method': 'GET', 'http.route': `/unknown/${index}`, 'http.status_code': 503 } })
    span.end()
  }
  expect(performance.now() - started).toBeLessThan(1000)
  expect(logs).toHaveLength(8)
  const metrics = () => fetch(monitoring.metricsUrl).then(response => response.text())
  const initial = await metrics()
  expect(initial).toContain('monitoring_trace_dropped_total{reason="volume"} 936')
  expect(initial).toContain('monitoring_request_log_dropped_total 992')
  expect(initial).toContain('route="/unmatched"')
  expect(initial).not.toContain('/unknown/')
  expect(initial).toMatch(/otel_sdk_processor_span_queue_capacity[^\n]* 128/)
  await vi.waitFor(async () => expect(await metrics()).toMatch(/otel_sdk_processor_span_processed[^\n]*error_type="Error"[^\n]* [1-9]/), { timeout: 6000 })
})
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test address')
  return `http://127.0.0.1:${address.port}`
}

it('rejects public trace destinations and releases resources when the private metrics port is unavailable', async () => {
  await expect(startRequestMonitoring({ endpoint: 'https://example.test/v1/traces' })).rejects.toThrow('private collector')
  const occupied = await listen(createServer((_request, response) => response.end('available')))
  await expect(startRequestMonitoring({ metricsPort: Number(new URL(occupied).port) })).rejects.toThrow('EADDRINUSE')
  expect(await fetch(occupied).then(response => response.text())).toBe('available')
})

it.each([0, 1])('counts requests and errors with sampling %s and exports only safe native and database fields', async sampleRatio => {
  const batches: unknown[] = [], logs: string[] = []
  const sink = await listen(createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk
    batches.push(JSON.parse(body)); response.end('{}')
  }))
  const monitoring = await startRequestMonitoring({ endpoint: `${sink}/v1/traces`, metricsHost: '127.0.0.1', metricsPort: 0, sampleRatio, log: line => logs.push(line) })
  cleanup.push(monitoring.stop)
  const { getAccountAccess, canWatchChannel } = await import('./viewing-access')
  const { getChannel, getChannels } = await import('./channels')
  const secrets = ['private-account', 'private@example.test', 'mtx_sk_PRIVATE', 'PRIVATE_BODY', 'PRIVATE_COOKIE', 'PRIVATE_SQL']
  const server = await listen(createServer((_request, response) => {
    const tracer = trace.getTracer('next.js')
    tracer.startActiveSpan(`GET /watch/${secrets[0]}?token=${secrets[2]}`, { kind: SpanKind.SERVER, attributes: {
      'next.span_type': 'BaseServer.handleRequest', 'http.method': 'GET', 'http.route': '/watch/[slug]',
      'http.target': secrets.join(' '), 'http.request.header.cookie': secrets[4],
    } }, span => {
      expect(getAccountAccess('private-account')?.emailVerified).toBe(1)
      expect(canWatchChannel('private-account', 'missing')).toBe(false)
      expect(getChannel('missing', 'private-account')).toBeUndefined()
      expect(Array.isArray(getChannels('private-account'))).toBe(true)
      span.addEvent('exception', { 'exception.message': secrets.join(' ') })
      span.setStatus({ code: SpanStatusCode.ERROR, message: secrets.join(' ') })
      span.setAttribute('http.status_code', 503)
      span.end(); response.writeHead(503).end()
    })
  }))
  expect((await fetch(server)).status).toBe(503)
  await monitoring.flush()
  const metrics = await fetch(monitoring.metricsUrl).then(response => response.text())
  expect(metrics).toMatch(/monitoring_request_total\{[^\n]*route="\/watch\/\[slug\]"[^\n]*\} 1/)
  expect(metrics).toMatch(/monitoring_request_errors_total\{[^\n]*\} 1/)
  expect(metrics).toContain('monitoring_request_duration_seconds_bucket')
  expect(metrics).toContain('operation="account_access"')
  expect(logs).toHaveLength(1)
  expect(JSON.parse(logs[0])).toMatchObject({ event: 'request_error', route: '/watch/[slug]', status: 503 })
  const serialized = JSON.stringify(batches)
  for (const secret of secrets) {
    expect(serialized).not.toContain(secret); expect(metrics).not.toContain(secret); expect(logs.join()).not.toContain(secret)
  }
  if (sampleRatio) {
    expect(serialized).toContain('database account_access')
    expect(serialized).toContain('database channel_read')
    expect(serialized).toContain('database channel_list')
    expect(serialized).toContain('database channel_watch_access')
    const record = JSON.parse(logs[0])
    expect(record.traceId).toMatch(/^[a-f0-9]{32}$/)
    expect(serialized).toContain(record.traceId)
  } else { expect(batches).toHaveLength(0); expect(logs[0]).not.toContain('traceId') }
})
