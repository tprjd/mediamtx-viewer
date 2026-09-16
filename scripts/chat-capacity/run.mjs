import { Centrifuge } from 'centrifuge'
import WebSocket from 'ws'
import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { capacityFailures, percentile, storageFailures } from './report.mjs'
import { measureStorageBudget } from './storage.mjs'

const exec = promisify(execFile)
const [configPath, outputPath] = process.argv.slice(2)
if (!configPath || !outputPath) throw new Error('Usage: node scripts/chat-capacity/run.mjs PRIVATE_CONFIG REPORT.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const origin = new URL(config.origin).origin
if (!origin.startsWith('https://') || !/^[a-zA-Z0-9_.-]+$/.test(config.channel) ||
    !/^[a-zA-Z0-9_.@-]+$/.test(config.sshTarget) || !/^\/[a-zA-Z0-9_./-]+$/.test(config.remoteDirectory) ||
    config.participants?.length !== 100 || config.participants.some(p => typeof p.cookie !== 'string' || !p.cookie))
  throw new Error('Configuration needs an HTTPS origin, Channel, SSH target, remote directory and 100 authenticated participants')
const endpoint = `/api/channels/${encodeURIComponent(config.channel)}/chat`
const clients = []
const submissions = new Map()
const latencies = {submission: [], delivery: [], history: [], status: []}
const report = {version: 1, origin, channel: config.channel, stage: 'STORAGE_PREFLIGHT', startedAt: new Date().toISOString(),
  durationSeconds: 0, connections: 0, accepted: 0, rejected: 0, lateSubmissions: 0,
  deliveryCount: 0, expectedDeliveryCount: 0, historyPages: 0, reconnectMs: [],
  playbackSamples: 0, playbackFailures: 0, statusSamples: 0, statusFailures: 0,
  statusMaxAgeMs: 0, heartbeats: 0, heartbeatMaxGapMs: 0,
  hostSamples: 0, hostFailures: 0, hosts: [], playback: [], errors: [], steadyState: false}
let browser
let running = true
let loadStarted = false
let observer
const tasks = []
const writeReport = () => writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', {mode: 0o600})
const request = async (index, path, init = {}) => {
  const response = await fetch(origin + path, {...init,
    headers: {cookie: config.participants[index].cookie, origin, 'content-type': 'application/json'},
    signal: AbortSignal.timeout(5000), redirect: 'error'})
  if (!response.ok) throw new Error(`HTTP_${response.status}`)
  return response.json()
}
const hostSample = async phase => {
  const {stdout} = await exec('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', config.sshTarget,
    `cd '${config.remoteDirectory}' && python3 scripts/chat-capacity/host.py`], {timeout: 30000, maxBuffer: 1024 * 1024})
  const sample = {...JSON.parse(stdout), phase}
  const previous = report.hosts.at(-1)
  if (previous) sample.cpuPercent = 100 * (1 - (sample.cpuIdle - previous.cpuIdle) / (sample.cpuTotal - previous.cpuTotal))
  report.hosts.push(sample)
  return sample
}
const healthyHost = sample => sample.architecture === 'aarch64' &&
  sample.memoryAvailableBytes >= 1024 ** 3 && sample.database.integrity === 'ok' &&
  sample.database.freeBytes >= sample.database.minimumFreeBytes &&
  sample.containers.length === 2 && sample.containers.every(c => c.health === 'healthy' && c.running)
const periodic = async (interval, work) => {
  while (running) {
    const start = performance.now()
    try { await work() } catch { report.errors.push('OBSERVATION_FAILED'); running = false }
    await delay(Math.max(1, interval - (performance.now() - start)))
  }
}
async function reconcile(index, after, expected) {
  let cursor = after
  const received = new Map()
  for (;;) {
    const page = await request(index, `${endpoint}/messages?after=${cursor}`)
    for (const message of page.messages) {
      const sequence = message.revisionSequence ?? message.sequence
      cursor = Math.max(cursor, sequence)
      received.set(sequence, message.id)
    }
    if (!page.hasMore) {
      for (const [sequence, id] of expected)
        if (sequence > after && received.get(sequence) !== id) throw new Error('RECONCILIATION_GAP')
      return cursor
    }
    if (!page.messages.length) throw new Error('EMPTY_RECONCILIATION_PAGE')
  }
}
try {
  report.storage = await measureStorageBudget()
  report.stage = 'HOST_PREFLIGHT'
  const baseline = await hostSample('before')
  const storageErrors = storageFailures(report.storage, baseline)
  if (!healthyHost(baseline) || storageErrors.length) throw new Error('HOST_OR_STORAGE_PREFLIGHT_FAILED')
  const health = await request(0, '/api/health')
  if (health.status !== 'ok' || health.chat.status !== 'healthy') throw new Error('HEALTH_PREFLIGHT_FAILED')
  report.viewerImage = baseline.containers.find(c => c.service === 'viewer').imageId
  report.centrifugoImage = baseline.containers.find(c => c.service === 'centrifugo').image
  report.stage = 'PLAYBACK_SETUP'
  browser = await chromium.launch({headless: true, ...(config.browserExecutable ? {executablePath: config.browserExecutable} : {})})
  const context = await browser.newContext()
  await context.addCookies(config.participants[0].cookie.split(';').map(part => {
    const position = part.indexOf('=')
    return {name: part.slice(0, position).trim(), value: part.slice(position + 1).trim(), url: origin}
  }))
  const page = await context.newPage()
  await page.addInitScript(() => {
    sessionStorage.setItem('mediamtx-viewer:playback-mode', 'balanced')
    const records = {heartbeats: [], errors: 0}
    window.capacityStatus = records
    const Native = window.EventSource
    window.EventSource = class extends Native {
      constructor(...args) {
        super(...args)
        this.addEventListener('heartbeat', () => records.heartbeats.push(Date.now()))
        this.addEventListener('error', () => records.errors++)
      }
    }
  })
  await page.goto(`${origin}/watch/${config.channel}`)
  await page.waitForFunction(() => {
    const video = document.querySelector('video')
    return video && !video.paused && video.currentTime > 2 && video.getVideoPlaybackQuality().totalVideoFrames > 10
  }, null, {timeout: 60000})
  const video = await page.locator('video').elementHandle()
  await video.evaluate(element => {
    element.capacityInterruptions = 0
    for (const event of ['pause', 'emptied', 'abort', 'error', 'waiting'])
      element.addEventListener(event, () => element.capacityInterruptions++)
  })
  let previousPlayback = await video.evaluate(v => ({time: v.currentTime, source: v.currentSrc,
    frames: v.getVideoPlaybackQuality().totalVideoFrames}))
  const initialSource = previousPlayback.source
  const accounts = new Set()
  report.stage = 'REALTIME_SETUP'
  for (let index = 0; index < 100; index++) {
    const getToken = async () => (await request(index, `${endpoint}/token`)).token
    const token = await getToken()
    accounts.add(JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub)
    class AuthenticatedSocket extends WebSocket {
      constructor(url, protocols) { super(url, protocols, {headers: {Cookie: config.participants[index].cookie, Origin: origin}}) }
    }
    const client = new Centrifuge(origin.replace('https:', 'wss:') + '/chat/realtime/connection/websocket',
      {token, getToken, websocket: AuthenticatedSocket, minReconnectDelay: 250, maxReconnectDelay: 1000})
    const state = {client, sequence: 0, transcript: new Map(), seen: new Set(), intentionallyDisconnected: false}
    client.on('publication', event => {
      if (!event.channel.startsWith('chat:') || event.data.type !== 'message') return
      const message = event.data.message
      const sequence = message.revisionSequence ?? message.sequence
      state.sequence = Math.max(state.sequence, sequence)
      state.transcript.set(sequence, message.id)
      if (state.transcript.size > 500) state.transcript.delete(state.transcript.keys().next().value)
      const submission = submissions.get(message.submissionId)
      if (!submission || state.seen.has(message.submissionId)) return
      state.seen.add(message.submissionId)
      latencies.delivery.push(performance.now() - submission.started)
      report.deliveryCount++
    })
    client.on('disconnected', () => {
      if (loadStarted && running && !state.intentionallyDisconnected) report.errors.push('UNEXPECTED_DISCONNECT')
    })
    clients.push(state)
    client.connect()
    await client.ready(10000)
    report.connections = clients.length
  }
  if (accounts.size < 20) throw new Error('NEED_AT_LEAST_20_DISTINCT_ACCOUNTS_FOR_RATE_LIMITS')
  report.connections = clients.length
  // Browser observations continue through the reconnect and steady-state checks.
  observer = periodic(1000, async () => {
    const current = await video.evaluate(v => ({time: v.currentTime, source: v.currentSrc,
      connected: v.isConnected, paused: v.paused, frames: v.getVideoPlaybackQuality().totalVideoFrames,
      interruptions: v.capacityInterruptions}))
    const state = await page.evaluate(() => ({mode: sessionStorage.getItem('mediamtx-viewer:playback-mode'),
      status: window.capacityStatus, recovery: /Frozen playback recovery|Reconnecting|Falling back/.test(document.querySelector('[aria-label="Playback diagnostics"]')?.textContent ?? '')}))
    report.playbackSamples++
    if (!current.connected || current.paused || current.source !== initialSource || current.interruptions ||
        current.time <= previousPlayback.time || current.frames <= previousPlayback.frames ||
        state.mode !== 'balanced' || state.recovery) report.playbackFailures++
    previousPlayback = current
    report.playback.push({at: Date.now(), ...current, mode: state.mode, recovery: state.recovery})
    const beats = state.status.heartbeats
    report.heartbeats = beats.length
    report.heartbeatMaxGapMs = Math.max(report.heartbeatMaxGapMs,
      ...beats.slice(1).map((value, index) => value - beats[index]), beats.length ? Date.now() - beats.at(-1) : 0)
    report.statusFailures = Math.max(report.statusFailures, state.status.errors)
  })
  tasks.push(periodic(2000, async () => {
    const start = performance.now()
    const result = await request(0, `/api/channels/${config.channel}/status`)
    latencies.status.push(performance.now() - start)
    report.statusSamples++
    report.statusMaxAgeMs = Math.max(report.statusMaxAgeMs, Date.now() - Date.parse(result.status.checkedAt))
    if (!result.status.live) report.statusFailures++
  }))
  tasks.push(periodic(10000, async () => {
    const sample = await hostSample('load')
    report.hostSamples++
    if (!healthyHost(sample)) report.hostFailures++
    const start = performance.now()
    const history = await request(0, `${endpoint}/messages`)
    if (history.messages.length === 100) {
      latencies.history.push(performance.now() - start)
      report.historyPages++
    }
    writeReport()
  }))
  const start = performance.now()
  report.stage = 'LOAD'
  loadStarted = true
  const inFlight = new Set()
  for (let i = 0; i < 9000 && running; i++) {
    const due = start + i * 100
    await delay(Math.max(0, due - performance.now()))
    if (performance.now() - due > 100) report.lateSubmissions++
    const key = randomUUID()
    const submissionId = createHash('sha256').update(key).digest('hex')
    submissions.set(submissionId, {started: performance.now()})
    const task = request(i % 100, `${endpoint}/messages`, {method: 'POST',
      body: JSON.stringify({content: `Capacity check ${i + 1}`, clientIdempotencyKey: key})})
      .then(() => {report.accepted++; latencies.submission.push(performance.now() - submissions.get(submissionId).started)})
      .catch(() => {report.rejected++})
      .finally(() => inFlight.delete(task))
    inFlight.add(task)
  }
  await Promise.all(inFlight)
  if (!running) throw new Error('OBSERVATION_FAILED')
  await delay(Math.max(0, start + 900000 - performance.now()))
  report.durationSeconds = (performance.now() - start) / 1000
  await delay(3000)
  report.expectedDeliveryCount = report.accepted * 100
  // Reconnect all clients and reconcile persisted room sequences under the same five-second deadline.
  // Rewind beyond Centrifugo's 300-event cache so this also proves database reconciliation.
  report.stage = 'RECONCILIATION'
  await Promise.all(clients.map(async (state, index) => {
    state.intentionallyDisconnected = true
    const after = Math.max(0, state.sequence - 400)
    const target = state.sequence
    state.client.disconnect()
    const start = performance.now()
    state.client.connect()
    await state.client.ready(5000)
    const reconciled = await reconcile(index, after, state.transcript)
    if (reconciled < target) throw new Error('RECONCILIATION_INCOMPLETE')
    report.reconnectMs.push(performance.now() - start)
    state.intentionallyDisconnected = false
  }))
  for (const state of clients) {state.intentionallyDisconnected = true; state.client.disconnect()}
  report.stage = 'STEADY_STATE'
  await delay(30000)
  const steady = []
  for (let i = 0; i < 3; i++) {
    const sample = await hostSample('after')
    const health = await request(0, '/api/health')
    steady.push(healthyHost(sample) && sample.database.outboxDepth === 0 &&
      Number.isFinite(sample.cpuPercent) && sample.cpuPercent <= 70 &&
      sample.containers.every(c => c.restarts === baseline.containers.find(b => b.service === c.service)?.restarts) &&
      health.status === 'ok' && health.chat.status === 'healthy')
    await delay(5000)
  }
  report.steadyState = steady.every(Boolean)
} catch (error) {
  // Request errors can contain credentials or submitted content. Keep fixed operational codes only.
  report.errors.push(/^[A-Z_]+$/.test(error.message) ? error.message : `${report.stage}_FAILED`)
} finally {
  running = false
  await Promise.allSettled([...tasks, observer].filter(Boolean))
  for (const state of clients) state.client.disconnect()
  await browser?.close()
  report.submissionP95Ms = percentile(latencies.submission)
  report.deliveryP95Ms = percentile(latencies.delivery)
  report.historyP95Ms = percentile(latencies.history)
  report.statusP95Ms = percentile(latencies.status)
  report.finishedAt = new Date().toISOString()
  report.failures = capacityFailures(report)
  report.passed = report.failures.length === 0
  if (!report.passed) {
    try {
      await exec('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', config.sshTarget,
        `cd '${config.remoteDirectory}' && sh deploy/oracle/chat-rollout.sh disable`],
      {timeout: 60000, maxBuffer: 1024 * 1024})
      report.rollbackSucceeded = true
    } catch {
      report.rollbackSucceeded = false
      report.errors.push('ROLLBACK_FAILED')
    }
  }
  writeReport()
  console.log(JSON.stringify({passed: report.passed, failures: report.failures}))
  if (!report.passed) process.exitCode = 1
}
