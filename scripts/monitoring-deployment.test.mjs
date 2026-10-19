// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, request as playwrightRequest } from '@playwright/test'
import { expect, it } from 'vitest'

const contextArgs = process.env.DOCKER_CONTEXT ? ['--context', process.env.DOCKER_CONTEXT] : []
const docker = (...args) => execFileSync('docker', [...contextArgs, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).trim()

async function until(check) {
  let failure
  for (let n = 0; n < 90; n++) {
    try { return await check() } catch (error) { failure = error }
    await delay(1000)
  }
  throw failure
}

it('shows private service diagnostics and VM history while bounded collectors survive delivery outages', async () => {
  const channelDashboard = JSON.parse(readFileSync('deploy/monitoring/channel-health.json', 'utf8'))
  let browser, hlsClient, hlsKeepAlive
  const serviceDashboard = JSON.parse(readFileSync('deploy/monitoring/service-health.json', 'utf8'))
  const dashboard = JSON.parse(readFileSync('deploy/monitoring/vm-health.json', 'utf8'))
  const context = process.env.DOCKER_CONTEXT ?? docker('context', 'show')
  const contextEndpoint = JSON.parse(docker('context', 'inspect', context))[0].Endpoints.docker.Host
  const endpoint = process.env.DOCKER_CONTEXT ? contextEndpoint : process.env.DOCKER_HOST ?? contextEndpoint
  if (!endpoint.startsWith('unix://')) throw new Error('Monitoring tests require a local Docker socket')
  const project = `monitoring-test-${randomUUID()}`
  const receiver = `${project}-receiver`
  const grafana = `${project}-grafana`
  const media = `${project}-media`
  const publisher = `${project}-publisher`
  const loki = `${project}-loki`
  const viewer = `${project}-viewer`
  const compose = (...args) => execFileSync('docker', [...contextArgs, 'compose', '-p', project, '-f', 'deploy/monitoring/compose.yaml', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, env: { ...process.env, ...environment },
  }).trim()
  const environment = { MONITORING_INSTANCE: project, GRAFANA_METRICS_USER: 'fixture', GRAFANA_METRICS_TOKEN: 'fixture-only', MONITORING_PROJECT: project, GRAFANA_LOGS_USER: 'fixture', GRAFANA_LOGS_TOKEN: 'fixture-only' }
  try {
    docker('build', '-q', '-t', 'frankerzspam-hls-media-test:local', '-f', 'scripts/hls-media.Dockerfile', '.')
    docker('run', '-d', '--name', media, '--label', `com.docker.compose.project=${project}`, '--label', 'com.docker.compose.service=mediamtx', '-p', '127.0.0.1::9997', '-p', '127.0.0.1::9998', '-p', '127.0.0.1::8888', '-p', '127.0.0.1::8889', '-p', '127.0.0.1:18190:18190/udp', '-e', 'MTX_AUTHINTERNALUSERS_1_IPS=', '-e', 'MTX_API=yes', '-e', 'MTX_METRICS=yes', '-e', 'MTX_WEBRTCLOCALUDPADDRESS=:18190', '-e', 'MTX_WEBRTCADDITIONALHOSTS=127.0.0.1', '-e', 'MTX_HLSALWAYSREMUX=yes', 'bluenviron/mediamtx:1.20.1')
    const mediaState = JSON.parse(docker('inspect', media))[0]
    const mediaUrl = port => `http://127.0.0.1:${mediaState.NetworkSettings.Ports[`${port}/tcp`][0].HostPort}`
    const mediaApi = async path => { const response = await fetch(mediaUrl(9997) + path); expect(response.ok).toBe(true); return response.json() }
    const mediaAddress = JSON.parse(docker('inspect', media))[0].NetworkSettings.Networks.bridge.IPAddress
    docker('run', '-d', '--name', publisher, '--entrypoint', 'ffmpeg', 'frankerzspam-hls-media-test:local',
      '-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-profile:v', 'baseline', '-g', '20', '-f', 'flv', `rtmp://${mediaAddress}:1935/live`)
    const playback = () => {
      expect(JSON.parse(docker('inspect', publisher))[0].State.Running).toBe(true)
      docker('run', '--rm', '--entrypoint', 'ffmpeg', 'frankerzspam-hls-media-test:local',
        '-hide_banner', '-loglevel', 'error', '-rw_timeout', '10000000', '-i', `http://${mediaAddress}:8888/live/index.m3u8`, '-frames:v', '3', '-f', 'null', '-')
    }
    docker('run', '-d', '--name', receiver, '-p', '127.0.0.1::9090', 'prom/prometheus:v3.15.0',
      '--config.file=/dev/null', '--web.enable-remote-write-receiver', '--storage.tsdb.retention.time=1h')
    const receiverState = JSON.parse(docker('inspect', receiver))[0]
    const port = receiverState.NetworkSettings.Ports['9090/tcp'][0].HostPort
    environment.GRAFANA_METRICS_URL = `http://${receiverState.NetworkSettings.Networks.bridge.IPAddress}:9090/api/v1/write`
    const query = async expression => {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/query?query=${encodeURIComponent(expression)}`, { signal: AbortSignal.timeout(3000) })
      const result = await response.json()
      expect(result.status).toBe('success')
      return result.data.result
    }
    docker('run', '-d', '--name', loki, '-p', '127.0.0.1::3100', 'grafana/loki:3.7.7', '-config.file=/etc/loki/local-config.yaml', '-auth.enabled=false')
    const lokiState = JSON.parse(docker('inspect', loki))[0]
    const lokiAddress = `http://${lokiState.NetworkSettings.Networks.bridge.IPAddress}:3100`
    const lokiPort = lokiState.NetworkSettings.Ports['3100/tcp'][0].HostPort
    environment.GRAFANA_LOGS_URL = `${lokiAddress}/loki/api/v1/push`
    await until(async () => expect((await fetch(`http://127.0.0.1:${lokiPort}/ready`)).ok).toBe(true))
    const privateValues = ['mtx_sk_PRIVATE_TEST', 'private.person@example.test', 'https://private.example.test/?token=SECRET_TEST', 'PRIVATE_CHAT_CONTENT', 'ACCOUNT_NAME_TEST', '192.0.2.123']
    const fixtureCode = `let failed=false;require('http').createServer((req,res)=>{if(req.url==='/fail'){failed=true;console.error(JSON.stringify({level:'error',msg:'ECONNREFUSED '+${JSON.stringify(privateValues.join(' '))}}))}if(req.url==='/recover')failed=false;res.writeHead(failed?503:200).end(JSON.stringify({status:failed?'error':'ok',version:'2.1.6',chat:{status:'healthy',faults:[],uncheckedFaults:[],outboxDepth:0}}))}).listen(3000,'0.0.0.0')`
    docker('run', '-d', '--name', viewer, '-p', '127.0.0.1::3000', '--label', `com.docker.compose.project=${project}`, '--label', 'com.docker.compose.service=viewer',
      'node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1', 'node', '-e', fixtureCode)
    const viewerPort = JSON.parse(docker('inspect', viewer))[0].NetworkSettings.Ports['3000/tcp'][0].HostPort
    compose('up', '-d')
    await until(async () => {
      const result = await query(`node_memory_MemTotal_bytes{instance="${project}"}`)
      expect(result).toHaveLength(1)
      expect(Number(result[0].value[1])).toBeGreaterThan(1024 ** 3)
    })
    for (const metric of ['node_cpu_seconds_total', 'node_load1', 'node_filesystem_size_bytes',
      'node_filesystem_files', 'node_disk_read_bytes_total', 'node_network_receive_bytes_total']) {
      expect((await query(`${metric}{instance="${project}"}`)).length, metric).toBeGreaterThan(0)
    }
    const collector = JSON.parse(docker('inspect', compose('ps', '-q', 'alloy')))[0]
    expect(collector.Config.User).toBe('65534:65534')
    expect(collector.HostConfig.Privileged).toBe(false)
    expect(collector.HostConfig.ReadonlyRootfs).toBe(true)
    expect(collector.HostConfig.Memory).toBe(512 * 1024 ** 2)
    expect(collector.HostConfig.MemorySwap).toBe(collector.HostConfig.Memory)
    expect(collector.HostConfig.NanoCpus).toBe(250000000)
    expect(collector.HostConfig.PidsLimit).toBe(64)
    expect(collector.Mounts.every(mount => mount.Type === 'tmpfs' || !mount.RW)).toBe(true)
    expect(collector.Mounts.some(mount => mount.Source?.includes('docker.sock'))).toBe(false)
    expect(() => docker('run', '--rm', 'alpine:3.22.1', 'wget', '-T', '2', '-qO-',
      `http://${receiverState.NetworkSettings.Networks.bridge.Gateway}:12345/metrics`)).toThrow()
    docker('run', '-d', '--name', grafana, '-p', '127.0.0.1::3000',
      '-e', 'GF_SECURITY_ADMIN_PASSWORD=fixture-only', '-e', 'GF_AUTH_ANONYMOUS_ENABLED=false',
      '-e', 'GF_ANALYTICS_REPORTING_ENABLED=false', '-e', 'GF_ANALYTICS_CHECK_FOR_UPDATES=false',
      'grafana/grafana:13.2.4')
    const grafanaPort = JSON.parse(docker('inspect', grafana))[0].NetworkSettings.Ports['3000/tcp'][0].HostPort
    const grafanaUrl = `http://127.0.0.1:${grafanaPort}`
    const request = (path, body) => fetch(`${grafanaUrl}${path}`, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(5000),
      headers: { authorization: `Basic ${Buffer.from('admin:fixture-only').toString('base64')}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    await until(async () => expect((await request('/api/health')).ok).toBe(true))
    expect((await request('/api/datasources', { uid: 'vm-test', name: 'VM test', type: 'prometheus', access: 'proxy',
      url: `http://${receiverState.NetworkSettings.Networks.bridge.IPAddress}:9090` })).ok).toBe(true)
    expect((await request('/api/dashboards/db', { dashboard, overwrite: true })).ok).toBe(true)
    expect((await request('/api/datasources', { uid: 'logs-test', name: 'Logs test', type: 'loki', access: 'proxy', url: lokiAddress })).ok).toBe(true)
    expect((await request('/api/dashboards/db', { dashboard: serviceDashboard, overwrite: true })).ok).toBe(true)
    expect((await request('/api/dashboards/db', { dashboard: channelDashboard, overwrite: true })).ok).toBe(true)
    await until(async () => expect((await query(`monitoring_application_up{instance="${project}"}`))[0]?.value[1]).toBe('1'))
    await until(async () => expect((await query(`monitoring_channel_live{instance="${project}",channel="live"}`))[0]?.value[1]).toBe('1'))
    const viewerId = randomUUID()
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${viewerPort}/api/health`)
    await page.evaluate(async ({ url, viewerId }) => {
      const peer = new RTCPeerConnection()
      window.monitoringPeer = peer
      peer.addTransceiver('video', { direction: 'recvonly' })
      await peer.setLocalDescription(await peer.createOffer())
      await new Promise(resolve => {
        if (peer.iceGatheringState === 'complete') resolve()
        else peer.addEventListener('icegatheringstatechange', () => { if (peer.iceGatheringState === 'complete') resolve() })
      })
      const response = await fetch(`${url}/live/whep?frankerzspam_viewer=${viewerId}`, { method: 'POST', headers: { 'content-type': 'application/sdp' }, body: peer.localDescription.sdp })
      if (response.status !== 201) throw new Error(`WHEP failed: ${response.status}`)
      window.monitoringSession = new URL(response.headers.get('location'), response.url).href
      await peer.setRemoteDescription({ type: 'answer', sdp: await response.text() })
    }, { url: mediaUrl(8889), viewerId })
    await until(async () => expect(await page.evaluate(async () => [...(await window.monitoringPeer.getStats()).values()].some(stat => stat.type === 'inbound-rtp' && stat.bytesReceived > 0))).toBe(true))
    await until(async () => expect((await query(`monitoring_channel_viewers{instance="${project}",channel="live"}`))[0]?.value[1]).toBe('1'))
    hlsClient = await playwrightRequest.newContext()
    const master = await hlsClient.get(`${mediaUrl(8888)}/live/index.m3u8?frankerzspam_viewer=${viewerId}`)
    expect(master.ok()).toBe(true)
    // MediaMTX carries its session secret in the rewritten child playlist URL.
    const child = (await master.text()).split('\n').find(line => line && !line.startsWith('#'))
    const playlist = await hlsClient.get(new URL(child, master.url()).href)
    expect(playlist.ok()).toBe(true)
    hlsKeepAlive = setInterval(() => void hlsClient.get(playlist.url()).catch(() => {}), 5000)
    const segment = (await playlist.text()).split('\n').find(line => line && !line.startsWith('#') && !line.startsWith('gap'))
    expect((await hlsClient.get(new URL(segment, playlist.url()).href)).ok()).toBe(true)
    await until(async () => {
      expect((await query(`monitoring_channel_connections{instance="${project}",channel="live",protocol="hls"}`))[0]?.value[1]).toBe('1')
      expect((await query(`monitoring_channel_connections{instance="${project}",channel="live",protocol="webrtc"}`))[0]?.value[1]).toBe('1')
      expect((await query(`monitoring_channel_viewers{instance="${project}",channel="live"}`))[0]?.value[1]).toBe('1')
    })
    const pathReading = await mediaApi('/v3/paths/get/live')
    expect(pathReading.inboundBytes).toBeGreaterThan(0)
    expect(pathReading.readers.some(reader => reader.type === 'hlsSession')).toBe(true)
    const hlsReading = (await mediaApi('/v3/hlssessions/list')).items.find(session => session.query.includes(viewerId))
    const webRtcReading = (await mediaApi('/v3/webrtcsessions/list')).items.find(session => session.query.includes(viewerId))
    expect(hlsReading.outboundBytes).toBeGreaterThan(0)
    expect(webRtcReading.outboundBytes).toBeGreaterThan(0)
    const nativeMetrics = await (await fetch(mediaUrl(9998) + '/metrics')).text()
    for (const [name, minimum] of [['paths_inbound_bytes', pathReading.inboundBytes], ['hls_sessions_outbound_bytes', hlsReading.outboundBytes], ['webrtc_sessions_outbound_bytes', webRtcReading.outboundBytes]]) {
      const lines = nativeMetrics.split('\n').filter(line => line.startsWith(name + '{') && line.includes(name.startsWith('paths_') ? 'name="live"' : 'path="live"'))
      expect(lines.some(line => Number(line.split(' ').at(-1)) >= minimum), name).toBe(true)
    }
    await until(async () => expect((await query(`monitoring_channel_rates_complete{instance="${project}",channel="live"}`))[0]?.value[1]).toBe('1'))
    for (const panel of channelDashboard.panels.filter(panel => panel.type !== 'logs')) {
      const target = panel.targets[0]
      const expr = target.expr.replaceAll('$instance', project).replaceAll('$channel', '.*')
      const result = await (await request('/api/ds/query', { from: String(Date.now() - 300000), to: String(Date.now()), queries: [{ ...target, expr, datasource: { uid: 'vm-test', type: 'prometheus' }, intervalMs: 15000, maxDataPoints: 1000 }] })).json()
      expect(result.results.A.error, panel.title).toBeUndefined()
      expect(result.results.A.frames.some(frame => frame.data?.values?.some(values => values.length > 0)), panel.title).toBe(true)
    }
    await page.evaluate(async () => { window.monitoringPeer.close(); await fetch(window.monitoringSession, { method: 'DELETE' }) })
    await until(async () => {
      expect((await query(`monitoring_channel_connections{instance="${project}",channel="live",protocol="webrtc"}`))[0]?.value[1]).toBe('0')
      expect((await query(`monitoring_channel_viewers{instance="${project}",channel="live"}`))[0]?.value[1]).toBe('1')
    })
    await browser.close(); browser = undefined
    clearInterval(hlsKeepAlive)
    docker('stop', '-t', '3', publisher)
    await until(async () => expect((await query(`monitoring_channel_live{instance="${project}",channel="live"}`))[0]?.value[1]).toBe('0'))
    docker('start', publisher)
    await until(async () => expect((await query(`monitoring_channel_live{instance="${project}",channel="live"}`))[0]?.value[1]).toBe('1'))
    const channelEvents = channelDashboard.panels.at(-1).targets[0].expr.replaceAll('$instance', project).replaceAll('$channel', '.*')
    await until(async () => {
      const result = await (await request(`/api/datasources/proxy/uid/logs-test/loki/api/v1/query_range?query=${encodeURIComponent(channelEvents)}&limit=1000`)).json()
      const text = JSON.stringify(result.data.result)
      for (const event of ['channel_observed', 'channel_stopped', 'channel_started']) expect(text).toContain(event)
      for (const value of [viewerId, pathReading.source.id, hlsReading.id, webRtcReading.id]) expect(text).not.toContain(value)
    })
    await fetch(`http://127.0.0.1:${viewerPort}/fail`)
    const logs = async () => {
      const expression = `{job="mediamtx/services",instance="${project}",service=~"viewer"} | json | release="2.1.6"`
      const result = await (await request(`/api/datasources/proxy/uid/logs-test/loki/api/v1/query_range?query=${encodeURIComponent(expression)}&limit=1000`)).json()
      expect(result.status).toBe('success')
      return JSON.stringify(result.data.result)
    }
    await until(async () => expect(await logs()).toContain('ECONNREFUSED'))
    await until(async () => expect((await query(`monitoring_application_up{instance="${project}"}`))[0]?.value[1]).toBe('0'))
    for (const secret of privateValues) expect(await logs()).not.toContain(secret)
    expect(await logs()).toContain('application_health')
    expect(await logs()).toContain('2.1.6')
    await fetch(`http://127.0.0.1:${viewerPort}/recover`)
    const observer = JSON.parse(docker('inspect', compose('ps', '-q', 'services')))[0]
    expect(observer.HostConfig.Memory).toBe(96 * 1024 ** 2)
    expect(observer.HostConfig.MemorySwap).toBe(observer.HostConfig.Memory)
    expect(observer.HostConfig.ReadonlyRootfs).toBe(true)
    expect(observer.Mounts.every(mount => !mount.RW)).toBe(true)
    expect(observer.Config.Env.some(value => value.startsWith('GRAFANA_'))).toBe(false)
    for (const port of [12346, 12347, 12348]) {
      expect(() => docker('run', '--rm', 'alpine:3.22.1', 'wget', '-T', '2', '-qO-', `http://${receiverState.NetworkSettings.Networks.bridge.Gateway}:${port}/metrics`)).toThrow()
    }
    const observerDiskBefore = docker('diff', observer.Id).split('\n').sort()
    docker('pause', loki)
    await fetch(`http://127.0.0.1:${viewerPort}/fail`)
    playback()
    await until(async () => {
      const result = await query(`loki_write_dropped_entries_total{instance="${project}"}`)
      expect(result.some(sample => Number(sample.value[1]) > 0)).toBe(true)
    })
    playback()
    expect(JSON.parse(docker('inspect', observer.Id))[0].State.OOMKilled).toBe(false)
    expect(docker('diff', observer.Id).split('\n').sort()).toEqual(observerDiskBefore)
    docker('unpause', loki)
    await fetch(`http://127.0.0.1:${viewerPort}/recover`)
    await until(async () => expect((await query(`monitoring_application_up{instance="${project}"}`))[0]?.value[1]).toBe('1'))
    for (const panel of serviceDashboard.panels.filter(panel => panel.type !== 'logs')) {
      for (const target of panel.targets ?? []) {
        const expression = target.expr.replaceAll('$instance', project).replaceAll('$service', '.*').replaceAll('$__rate_interval', '1m')
        const result = await query(expression)
        expect(result.length, panel.title).toBeGreaterThan(0)
        expect(result.every(sample => Number.isFinite(Number(sample.value[1]))), panel.title).toBe(true)
      }
    }
    for (const path of ['/api/dashboards/uid/mediamtx-vm', '/api/dashboards/uid/mediamtx-services', '/api/dashboards/uid/mediamtx-channels', '/api/datasources/proxy/uid/vm-test/api/v1/query?query=up', '/api/datasources/proxy/uid/logs-test/loki/api/v1/labels']) {
      expect((await fetch(`${grafanaUrl}${path}`, { signal: AbortSignal.timeout(5000) })).status).toBe(401)
    }
    for (const panel of dashboard.panels) {
      for (const target of panel.targets ?? []) {
        const expression = target.expr.replaceAll('$instance', project).replaceAll('$__rate_interval', '1m')
        await until(async () => {
          const result = await (await request(`/api/datasources/proxy/uid/vm-test/api/v1/query?query=${encodeURIComponent(expression)}`)).json()
          expect(result.status, panel.title).toBe('success')
          // Alloy creates the dropped-sample series only after the first drop.
          if (panel.title !== 'Dropped samples') expect(result.data.result.length, panel.title).toBeGreaterThan(0)
          expect(result.data.result.every(sample => Number.isFinite(Number(sample.value[1]))), panel.title).toBe(true)
        })
      }
    }
    playback()
    docker('pause', receiver)
    await delay(25000)
    playback()
    docker('unpause', receiver)
    await until(async () => {
      const result = await query(`prometheus_remote_storage_samples_retried_total{instance="${project}"}`)
      expect(Number(result[0]?.value[1])).toBeGreaterThan(0)
    })
    const interruptedAt = Date.now() / 1000
    docker('kill', collector.Id)
    playback()
    compose('up', '-d')
    await until(async () => {
      expect(JSON.parse(docker('inspect', collector.Id))[0].State.Running).toBe(true)
      const latest = await query(`timestamp(up{job="mediamtx/vm",instance="${project}"})`)
      expect(Number(latest[0]?.value[1])).toBeGreaterThan(interruptedAt)
    })
    console.info('Monitoring fixture measurements', JSON.stringify({
      hostMemoryBytes: (await query(`node_memory_MemTotal_bytes{instance="${project}"}`))[0].value[1],
      availableMemoryBytes: (await query(`node_memory_MemAvailable_bytes{instance="${project}"}`))[0].value[1],
      series: (await query(`count({instance="${project}"})`))[0].value[1],
      collector: JSON.parse(docker('stats', '--no-stream', '--format', '{{json .}}', collector.Id)),
    }))
    const recordedAt = (await query(`timestamp(node_memory_MemTotal_bytes{instance="${project}"})`))[0].value[1]
    compose('down')
    playback()
    expect((await query(`node_memory_MemTotal_bytes{instance="${project}"} @ ${recordedAt}`))).toHaveLength(1)
  } catch (error) {
    try { console.error(compose('logs', '--tail', '20')) } catch { /* Preserve the test failure if setup failed. */ }
    throw error
  } finally {
    clearInterval(hlsKeepAlive)
    await browser?.close()
    await hlsClient?.dispose()
    try { compose('down', '--remove-orphans') } finally { docker('rm', '-f', receiver, grafana, publisher, media, loki, viewer) }
  }
}, 540000)
