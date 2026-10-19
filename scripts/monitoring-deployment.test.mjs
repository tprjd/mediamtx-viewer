// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
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

it('sends real host measurements within bounds and keeps history when the collector stops', async () => {
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
  const compose = (...args) => execFileSync('docker', [...contextArgs, 'compose', '-p', project, '-f', 'deploy/monitoring/compose.yaml', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, env: { ...process.env, ...environment },
  }).trim()
  const environment = { MONITORING_INSTANCE: project, GRAFANA_METRICS_USER: 'fixture', GRAFANA_METRICS_TOKEN: 'fixture-only' }
  try {
    docker('build', '-q', '-t', 'frankerzspam-hls-media-test:local', '-f', 'scripts/hls-media.Dockerfile', '.')
    docker('run', '-d', '--name', media, '-e', 'MTX_HLSALWAYSREMUX=yes', 'bluenviron/mediamtx:1.20.1')
    const mediaAddress = JSON.parse(docker('inspect', media))[0].NetworkSettings.Networks.bridge.IPAddress
    docker('run', '-d', '--name', publisher, '--entrypoint', 'ffmpeg', 'frankerzspam-hls-media-test:local',
      '-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '20', '-f', 'flv', `rtmp://${mediaAddress}:1935/live`)
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
    for (const path of ['/api/dashboards/uid/mediamtx-vm', '/api/datasources/proxy/uid/vm-test/api/v1/query?query=up']) {
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
    try { compose('down', '--remove-orphans') } finally { docker('rm', '-f', receiver, grafana, publisher, media) }
  }
}, 240000)
