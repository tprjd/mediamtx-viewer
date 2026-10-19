// @vitest-environment node
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { startServiceMonitor } from '../deploy/monitoring/services.mjs'

const cleanup = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function listen(handler, socket) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(socket ?? { host: '127.0.0.1', port: 0 }, resolve))
  cleanup.push(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  return server.address().port
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'service-monitoring-'))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const privateValues = ['mtx_sk_PRIVATE_TEST', 'private.person@example.test', 'https://private.example.test/watch?secret=SECRET_TEST', 'PRIVATE_CHAT_CONTENT', 'ACCOUNT_NAME_TEST', '192.0.2.123']
  const health = { status: 'ok', version: '2.1.6', chat: { status: 'degraded', faults: ['outbox'], uncheckedFaults: [], outboxDepth: 2, oldestOutboxAgeSeconds: 7, databaseBytes: 1024, freeBytes: 2048 } }
  const state = { logs: [], restartCount: 0, dockerDown: false, receiverDown: false, exported: [], methods: [] }
  const healthPort = await listen((_request, response) => response.end(JSON.stringify(health)))
  const socket = join(directory, 'docker.sock')
  const container = { Id: 'a'.repeat(64), Labels: { 'com.docker.compose.project': 'fixture', 'com.docker.compose.service': 'viewer' }, Created: 1 }
  await listen((request, response) => {
    state.methods.push(request.method)
    if (state.dockerDown) { response.writeHead(503).end(); return }
    if (request.url.startsWith('/containers/json')) { response.end(JSON.stringify([container])); return }
    if (request.url.endsWith('/json')) {
      response.end(JSON.stringify({ Id: container.Id, Config: { Tty: false, Env: privateValues }, State: { Running: true, StartedAt: '2026-10-19T12:00:00Z', Health: { Status: 'healthy' } }, RestartCount: state.restartCount, NetworkSettings: { Networks: { bridge: { IPAddress: '127.0.0.1' } } } })); return
    }
    if (request.url.includes('/logs?')) {
      const content = Buffer.from(state.logs.join('\n') + '\n')
      const header = Buffer.alloc(8); header[0] = 1; header.writeUInt32BE(content.length, 4)
      response.end(Buffer.concat([header, content])); return
    }
    response.writeHead(404).end()
  }, socket)
  const logsPort = await listen(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk
    if (state.receiverDown) { response.writeHead(503).end(); return }
    state.exported.push(JSON.parse(body)); response.writeHead(204).end()
  })
  const monitor = await startServiceMonitor({ dockerSocket: socket, project: 'fixture', instance: 'test-vm', port: 0, intervalMs: 100, healthPort, logsUrl: `http://127.0.0.1:${logsPort}/loki/api/v1/push` })
  cleanup.push(monitor.stop)
  const metrics = () => fetch(`${monitor.url}/metrics`).then(response => response.text())
  return { state, health, privateValues, metrics }
}

it('exports service health and searchable errors without private log or health fields', async () => {
  const { state, health, privateValues, metrics } = await fixture()
  health.privateData = privateValues
  state.logs = [
    `${new Date().toISOString()} ${JSON.stringify({ level: 'error', msg: `ECONNREFUSED ${privateValues.join(' ')}`, details: privateValues })}`,
    `${new Date().toISOString()} ${JSON.stringify({ event: 'chat-health', code: 'outbox', result: 'failed', chat: privateValues })}`,
    `${new Date().toISOString()} ${privateValues.join(' ')}`,
  ]
  await vi.waitFor(() => expect(JSON.stringify(state.exported)).toContain('ECONNREFUSED'))
  const exported = JSON.stringify(state.exported)
  const measurements = await metrics()
  for (const secret of privateValues) { expect(exported).not.toContain(secret); expect(measurements).not.toContain(secret) }
  expect(exported).toContain('chat_health_failed')
  expect(exported).toContain('2.1.6')
  expect(measurements).toContain('monitoring_service_running{service="viewer"} 1')
  expect(measurements).toContain('monitoring_service_health{service="viewer"} 1')
  expect(measurements).toContain('monitoring_chat_outbox_depth 2')
  expect(measurements).toContain('monitoring_chat_fault{fault="outbox"} 1')
  expect(state.methods.every(method => method === 'GET')).toBe(true)
})

it('records restarts, unavailable collection, and recovery without stale health', async () => {
  const { state, metrics } = await fixture()
  await vi.waitFor(async () => expect(await metrics()).toContain('monitoring_service_collection_success 1'))
  state.restartCount = 2
  await vi.waitFor(() => expect(JSON.stringify(state.exported)).toContain('service_state_changed'))
  expect(await metrics()).toContain('monitoring_service_restarts_total{service="viewer"} 2')
  state.dockerDown = true
  await vi.waitFor(async () => expect(await metrics()).toContain('monitoring_service_collection_success 0'))
  expect(await metrics()).not.toContain('monitoring_service_running')
  state.dockerDown = false
  await vi.waitFor(async () => expect(await metrics()).toContain('monitoring_service_collection_success 1'))
})

it('bounds log volume and discards delivery failures instead of building a backlog', async () => {
  const { state, metrics } = await fixture()
  await vi.waitFor(async () => expect(await metrics()).toContain('monitoring_service_collection_success 1'))
  state.receiverDown = true
  const timestamp = new Date().toISOString()
  state.logs = Array.from({ length: 200 }, () => `${timestamp} ERROR ECONNRESET`)
  await vi.waitFor(async () => expect(await metrics()).toMatch(/monitoring_service_log_dropped_total\{reason="delivery"\} [1-9]/))
  expect(await metrics()).toMatch(/monitoring_service_log_dropped_total\{reason="volume"\} [1-9]/)
  expect(await metrics()).toMatch(/monitoring_service_log_gaps_total [1-9]/)
  state.receiverDown = false
  state.logs = [`${new Date().toISOString()} ERROR ENOSPC`]
  await vi.waitFor(() => expect(JSON.stringify(state.exported)).toContain('ENOSPC'))
  expect(JSON.stringify(state.exported)).not.toContain('ECONNRESET')
  for (const batch of state.exported) {
    expect(batch.streams.length).toBeLessThanOrEqual(64)
    expect(Buffer.byteLength(JSON.stringify(batch))).toBeLessThanOrEqual(65536)
  }
})

it('preserves nanosecond log cursors and rejects oversized and private health data', async () => {
  const { state, health, metrics, privateValues } = await fixture()
  await vi.waitFor(async () => expect(await metrics()).toContain('monitoring_service_collection_success 1'))
  const second = new Date().toISOString().slice(0, 19)
  state.logs = [`${second}.999000001Z ERROR ECONNRESET`]
  await vi.waitFor(() => expect(JSON.stringify(state.exported)).toContain('ECONNRESET'))
  state.logs.push(`${second}.999000002Z ERROR ENOSPC`, `${second}.999000003Z ERROR ${'x'.repeat(9000)}`)
  health.version = privateValues[0]
  health.chat.outboxDepth = privateValues[1]
  await vi.waitFor(() => expect(JSON.stringify(state.exported)).toContain('ENOSPC'))
  const values = state.exported.flatMap(batch => batch.streams.flatMap(stream => stream.values))
  expect(values.filter(([, line]) => line.includes('ECONNRESET'))).toHaveLength(1)
  expect(values.find(([, line]) => line.includes('ENOSPC'))[0]).toMatch(/999000002$/)
  expect(await metrics()).toMatch(/monitoring_service_log_dropped_total\{reason="oversized"\} [1-9]/)
  expect(await metrics()).not.toContain(privateValues[0])
  expect(await metrics()).not.toContain('monitoring_chat_outbox_depth')
})

it('classifies native exceptions and the application status monitor without raw messages', async () => {
  const { state, privateValues } = await fixture()
  const timestamp = new Date().toISOString()
  state.logs = [
    `${timestamp} TypeError: ${privateValues[0]}`,
    `${timestamp} ReferenceError: ${privateValues[1]}`,
    `${timestamp} MediaMTX status monitor is temporarily unavailable ${privateValues[2]}`,
    `${timestamp} MediaMTX status monitor recovered`,
  ]
  await vi.waitFor(() => expect(JSON.stringify(state.exported)).toContain('media_status_recovered'))
  const lines = state.exported.flatMap(batch => batch.streams.flatMap(stream => stream.values.map(([, line]) => JSON.parse(line))))
  expect(lines.filter(line => line.event === 'service_error')).toHaveLength(2)
  expect(lines.some(line => line.event === 'media_status_failed')).toBe(true)
  for (const secret of privateValues) expect(JSON.stringify(lines)).not.toContain(secret)
})

it('counts full windows and oversized records once when Docker repeats a timestamp second', async () => {
  const { state, metrics } = await fixture()
  const timestamp = new Date().toISOString()
  state.logs = Array.from({ length: 199 }, () => `${timestamp} ERROR ECONNRESET`)
  state.logs.push(`${timestamp} ERROR ${'x'.repeat(9000)}`)
  await vi.waitFor(async () => expect(await metrics()).toContain('monitoring_service_log_dropped_total{reason="oversized"} 1'))
  await new Promise(resolve => setTimeout(resolve, 350))
  expect(await metrics()).toContain('monitoring_service_log_dropped_total{reason="oversized"} 1\n')
  expect(await metrics()).toContain('monitoring_service_log_gaps_total 1\n')
})
