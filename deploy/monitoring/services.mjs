import { createServer, request } from 'node:http'
import { isIP } from 'node:net'
import { pathToFileURL } from 'node:url'

const services = ['viewer', 'caddy', 'mediamtx', 'mediamtx-health', 'centrifugo', 'thumbnailer', 'discord-notifier']
const faults = ['configuration', 'database', 'centrifugo', 'outbox', 'database-limit', 'disk-limit', 'disk-check']
const chatStates = ['disabled', 'healthy', 'degraded', 'unavailable']
const errorCodes = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOSPC', 'EACCES', 'ENOMEM', 'SQLITE_BUSY', 'SQLITE_FULL', 'SQLITE_CORRUPT']
const logEvents = [
  [/Thumbnail capture failed/i, 'thumbnail_failed', 'error', 'Thumbnail capture failed'],
  [/MediaMTX status unavailable|MediaMTX status monitor is temporarily unavailable/i, 'media_status_failed', 'error', 'Media service status unavailable'],
  [/MediaMTX API connection restored|MediaMTX status monitor recovered/i, 'media_status_recovered', 'info', 'Media service status restored'],
  [/HLS audio worker stopped/i, 'hls_worker_stopped', 'warn', 'HLS audio worker stopped; retry scheduled'],
  [/HLS worker control loop failed/i, 'hls_worker_failed', 'error', 'HLS worker control loop failed'],
  [/Discord notifier stream failed/i, 'notifier_failed', 'error', 'Existing notifier connection failed'],
  [/authentication failed|invalid credentials|unauthorized/i, 'authentication_failed', 'warn', 'Service authentication failed'],
  [/Ready in \d+|Thumbnail worker ready|server running|listener opened/i, 'service_ready', 'info', 'Service ready'],
  [/connection.*opened|session.*created/i, 'connection_opened', 'info', 'Media connection opened'],
  [/connection.*closed|session.*destroyed/i, 'connection_closed', 'info', 'Media connection closed'],
]

// Export fixed descriptions, never a redacted copy of arbitrary application text.
function logRecord(text) {
  let value
  try { value = JSON.parse(text) } catch { /* Native service logs can be plain text. */ }
  if (value?.event === 'chat-health' && faults.includes(value.code) && ['failed', 'recovered'].includes(value.result)) {
    return { event: `chat_health_${value.result}`, level: value.result === 'failed' ? 'error' : 'info', message: `Chat health ${value.result}`, code: value.code }
  }
  if (value?.event === 'chat-retention' && value.result === 'failed') {
    return { event: 'chat_retention_failed', level: 'error', message: 'Chat retention failed', code: 'CLEANUP_FAILED' }
  }
  const message = typeof value?.msg === 'string' ? value.msg : typeof value?.message === 'string' ? value.message : text
  const match = logEvents.find(([pattern]) => pattern.test(message))
  const level = ['error', 'fatal', 'panic'].includes(value?.level) || /\b(?:ERR|ERROR|[A-Z][A-Za-z]*Error|Error|error|failed|exception)\b/.test(message)
    ? 'error' : ['warn', 'warning'].includes(value?.level) || /\bWARN?\b/.test(message) ? 'warn' : undefined
  const code = errorCodes.find(code => new RegExp(`\\b${code}\\b`).test(message))
  if (match) return { event: match[1], level: match[2], message: match[3], ...(code ? { code } : {}) }
  if (level || code) return { event: 'service_error', level: level ?? 'error', message: 'Service reported an error or warning; raw text withheld', ...(code ? { code } : {}) }
}

function readHttp(options, body, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const req = request({ ...options, signal: AbortSignal.timeout(2000) }, response => {
      const chunks = []; let size = 0
      response.on('data', chunk => {
        size += chunk.length
        if (size > limit) req.destroy(new Error('response-limit'))
        else chunks.push(chunk)
      })
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }))
      response.on('error', reject)
    })
    req.on('error', reject)
    req.end(body)
  })
}

function logText(buffer, tty) {
  if (tty) return buffer.toString('utf8')
  const chunks = []
  for (let offset = 0; offset < buffer.length;) {
    if (offset + 8 > buffer.length || ![1, 2].includes(buffer[offset])) throw new Error('log-frame')
    const size = buffer.readUInt32BE(offset + 4)
    if (offset + 8 + size > buffer.length) throw new Error('log-frame')
    chunks.push(buffer.subarray(offset + 8, offset + 8 + size))
    offset += 8 + size
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function startServiceMonitor({
  dockerSocket = '/var/run/docker.sock', project = 'mediamtx-viewer', instance = 'viewer-vm',
  port = 12346, intervalMs = 15000, healthPort = 3000,
  logsUrl = 'http://127.0.0.1:12347/loki/api/v1/push',
} = {}) {
  if (![project, instance].every(value => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/.test(value))) throw new Error('invalid-label')
  const destination = new URL(logsUrl)
  if (destination.protocol !== 'http:' || destination.hostname !== '127.0.0.1' || destination.pathname !== '/loki/api/v1/push') throw new Error('invalid-local-receiver')
  let stopped = false, timer, pending, observed = [], collectionSuccess = 0, lastSuccess = 0, collectionErrors = 0, deliveryErrors = 0, lastDelivery = 0
  let release = 'unknown', previousHealth, lastHeartbeat = 0
  const previous = new Map()
  const drops = { unrecognized: 0, oversized: 0, volume: 0, delivery: 0, timestamp: 0 }
  let gaps = 0
  const docker = async path => {
    const result = await readHttp({ socketPath: dockerSocket, path, method: 'GET' })
    if (result.status !== 200) throw new Error('docker-read')
    return result.body
  }
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
  const sample = (name, value, labels = '') => `monitoring_${name}${labels} ${value}`
  const metrics = () => [
    sample('service_collection_success', collectionSuccess), sample('service_last_success_seconds', lastSuccess),
    sample('service_collection_errors_total', collectionErrors), sample('service_log_gaps_total', gaps),
    sample('service_log_delivery_errors_total', deliveryErrors), sample('service_log_last_delivery_seconds', lastDelivery),
    ...Object.entries(drops).map(([reason, count]) => sample('service_log_dropped_total', count, `{reason="${reason}"}`)),
    ...observed,
  ].join('\n') + '\n'

  async function poll() {
    const entries = []; let bytes = 0
    const add = (service, record, timestamp = String(BigInt(Date.now()) * 1000000n)) => {
      const line = JSON.stringify({ ...record, release })
      const size = Buffer.byteLength(line) + 256
      if (entries.length >= 64 || bytes + size > 65536) { drops.volume++; return }
      bytes += size
      entries.push({ stream: { job: 'mediamtx/services', instance, service, level: record.level }, values: [[timestamp, line]] })
    }
    try {
      const filters = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${project}`] }))
      const listed = JSON.parse((await docker(`/containers/json?all=1&filters=${filters}`)).toString())
      if (!Array.isArray(listed) || listed.length > 32) throw new Error('container-limit')
      const selected = services.map(service => listed.filter(container => container.Labels?.['com.docker.compose.project'] === project && container.Labels?.['com.docker.compose.service'] === service)
        .sort((a, b) => b.Created - a.Created)[0])
      const details = await Promise.all(selected.map(async container => {
        if (!container) return undefined
        if (!/^[a-f0-9]{64}$/.test(container.Id)) throw new Error('container-id')
        return JSON.parse((await docker(`/containers/${container.Id}/json`)).toString())
      }))
      const next = []; let applicationUp = 0
      const viewer = details[0]
      let appHealth
      try {
        const address = Object.values(viewer?.NetworkSettings?.Networks ?? {}).map(network => network.IPAddress).find(address => isIP(address) === 4)
        if (!address) throw new Error('viewer-address')
        const result = await readHttp({ host: address, port: healthPort, path: '/api/health', method: 'GET' }, undefined, 16384)
        appHealth = JSON.parse(result.body.toString())
        release = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[a-zA-Z0-9.-]{1,24})?$/.test(appHealth.version) ? appHealth.version : 'unknown'
        applicationUp = result.status === 200 && appHealth.status === 'ok' ? 1 : 0
        next.push(sample('application_info', 1, `{version="${release}"}`))
      } catch { release = 'unknown' }
      next.push(sample('application_up', applicationUp))
      const chat = appHealth?.chat
      next.push(sample('chat_status', chatStates.includes(chat?.status) ? chatStates.indexOf(chat.status) : -1))
      for (const [field, metric] of Object.entries({ outboxDepth: 'outbox_depth', oldestOutboxAgeSeconds: 'oldest_outbox_age_seconds', databaseBytes: 'database_bytes', freeBytes: 'free_bytes' })) {
        if (number(chat?.[field])) next.push(sample(`chat_${metric}`, chat[field]))
      }
      if (Array.isArray(chat?.faults) && Array.isArray(chat?.uncheckedFaults)) {
        for (const fault of faults) next.push(sample('chat_fault', chat.uncheckedFaults.includes(fault) ? -1 : chat.faults.includes(fault) ? 1 : 0, `{fault="${fault}"}`))
      }
      const healthState = `${applicationUp}:${chatStates.includes(chat?.status) ? chat.status : 'unknown'}:${release}`
      if (healthState !== previousHealth || Date.now() - lastHeartbeat >= 60000) {
        add('viewer', { event: 'application_health', level: applicationUp ? 'info' : 'error', message: 'Application health observed', available: applicationUp === 1, chat: chatStates.includes(chat?.status) ? chat.status : 'unknown' })
        previousHealth = healthState; lastHeartbeat = Date.now()
      }
      await Promise.all(services.map(async (service, index) => {
        const detail = details[index], container = selected[index], before = previous.get(service)
        const running = detail?.State?.Running === true
        const health = detail?.State?.Health?.Status
        const started = Date.parse(detail?.State?.StartedAt ?? '') / 1000
        const restarts = detail?.RestartCount
        next.push(sample('service_running', running ? 1 : 0, `{service="${service}"}`))
        next.push(sample('service_health', health === 'healthy' ? 1 : health === 'unhealthy' ? 0 : -1, `{service="${service}"}`))
        if (number(started)) next.push(sample('service_started_seconds', started, `{service="${service}"}`))
        if (number(restarts)) next.push(sample('service_restarts_total', restarts, `{service="${service}"}`))
        const state = `${container?.Id ?? 'missing'}:${started}:${restarts}:${running}:${health}`
        if (state !== before?.state) add(service, { event: before ? 'service_state_changed' : 'service_observed', level: running && health !== 'unhealthy' ? 'info' : 'warn', message: 'Service state observed', running, health: ['healthy', 'unhealthy', 'starting'].includes(health) ? health : 'unknown', ...(number(restarts) ? { restarts } : {}) })
        const cursor = before && before.id === container?.Id ? before.cursor : BigInt(Date.now() - intervalMs) * 1000000n
        previous.set(service, { state, id: container?.Id, cursor })
        if (!container) return
        try {
          const body = await docker(`/containers/${container.Id}/logs?stdout=1&stderr=1&timestamps=1&tail=200&since=${cursor / 1000000000n}`)
          const lines = logText(body, detail.Config?.Tty).split('\n').filter(Boolean)
          let latest = cursor
          for (const line of lines.slice(-200)) {
            const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z) /.exec(line)
            const millis = match ? Date.parse(match[1]) : NaN
            if (!Number.isFinite(millis) || millis > Date.now() + 60000) { drops.timestamp++; continue }
            const fraction = match[1].match(/\.(\d+)Z$/)?.[1] ?? ''
            const time = BigInt(Math.floor(millis / 1000)) * 1000000000n + BigInt(fraction.padEnd(9, '0'))
            if (time <= cursor) continue
            if (time > latest) latest = time
            if (Buffer.byteLength(line) > 8192) { drops.oversized++; continue }
            const record = logRecord(line.slice(match[0].length))
            if (record) add(service, record, String(time))
            else drops.unrecognized++
          }
          if (lines.length >= 200 && latest > cursor) gaps++
          previous.get(service).cursor = latest
          next.push(sample('service_log_read_success', 1, `{service="${service}"}`))
        } catch { gaps++; next.push(sample('service_log_read_success', 0, `{service="${service}"}`)) }
      }))
      observed = next; collectionSuccess = 1; lastSuccess = Date.now() / 1000
    } catch { observed = []; collectionSuccess = 0; collectionErrors++ }
    if (entries.length) {
      try {
        const result = await readHttp({ hostname: destination.hostname, port: destination.port, path: destination.pathname, method: 'POST', headers: { 'content-type': 'application/json' } }, JSON.stringify({ streams: entries }), 16384)
        if (result.status !== 204 && result.status !== 200) throw new Error('local-delivery')
        lastDelivery = Date.now() / 1000
      } catch { deliveryErrors++; drops.delivery += entries.length }
    }
  }
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/metrics') { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }).end(metrics())
  })
  server.maxConnections = 8; server.requestTimeout = 3000; server.headersTimeout = 3000
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  const tick = () => {
    const started = Date.now()
    pending = poll().finally(() => { if (!stopped) timer = setTimeout(tick, Math.max(0, intervalMs - (Date.now() - started))) })
  }
  tick()
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    stop: async () => { stopped = true; clearTimeout(timer); await pending; await new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }) },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServiceMonitor({ project: process.env.MONITORING_PROJECT, instance: process.env.MONITORING_INSTANCE })
    .then(monitor => {
      process.once('SIGTERM', () => void monitor.stop())
      process.once('SIGINT', () => void monitor.stop())
    }).catch(() => { console.error('Service monitoring could not start'); process.exitCode = 1 })
}
