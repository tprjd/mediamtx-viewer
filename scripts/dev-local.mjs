import nextEnv from '@next/env'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createSocket } from 'node:dgram'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { localAdminFromEnvironment } from './bootstrap-local-admin.mjs'

const { loadEnvConfig } = nextEnv

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const loopbackHost = '127.0.0.1'
const localhostHost = 'localhost'

export const DEFAULT_LOCAL_PORTS = Object.freeze({
  next: 3000,
  rtmp: 1935,
  hls: 8888,
  webrtc: 8889,
  api: 9997,
  ice: 8189,
})

const portProtocols = Object.freeze({
  next: { tcp: true },
  rtmp: { tcp: true },
  hls: { tcp: true },
  webrtc: { tcp: true },
  api: { tcp: true },
  ice: { tcp: true, udp: true },
})

function validPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535
}

function listenTcp(port, host) {
  return new Promise((resolve) => {
    const server = createServer()
    let settled = false
    const finish = (available) => {
      if (settled) return
      settled = true
      resolve(available)
    }
    server.once('error', () => finish(false))
    server.listen({ host, port }, () => {
      server.close(() => finish(true))
    })
  })
}

function listenUdp(port, host) {
  return new Promise((resolve) => {
    const socket = createSocket('udp4')
    let settled = false
    const finish = (available) => {
      if (settled) return
      settled = true
      try {
        socket.close(() => resolve(available))
      } catch {
        resolve(available)
      }
    }
    socket.once('error', () => finish(false))
    socket.bind(port, host, () => finish(true))
  })
}

export async function isPortAvailable(
  port,
  { host = loopbackHost, tcp = true, udp = false } = {},
) {
  if (!validPort(port)) return false
  if (tcp && !(await listenTcp(port, host))) return false
  if (udp && !(await listenUdp(port, host))) return false
  return true
}

export async function selectLocalPorts({
  defaults = DEFAULT_LOCAL_PORTS,
  isAvailable = (port, protocols) => isPortAvailable(port, protocols),
} = {}) {
  const ports = {}
  const selected = new Set()

  for (const [service, defaultPort] of Object.entries(defaults)) {
    if (!validPort(defaultPort)) {
      throw new Error(`Invalid default port for ${service}: ${defaultPort}`)
    }
    const protocols = portProtocols[service] ?? { tcp: true }
    let candidate = defaultPort
    while (
      selected.has(candidate) ||
      !(await isAvailable(candidate, protocols))
    ) {
      candidate += 1
      if (!validPort(candidate)) {
        throw new Error(`No available local port found for ${service}.`)
      }
    }
    ports[service] = candidate
    selected.add(candidate)
  }

  return ports
}

function yamlString(value) {
  return JSON.stringify(value)
}

export function buildMediaMtxConfig({
  ports,
  authSecret,
  nextOrigin = `http://${loopbackHost}:${ports.next}`,
  localhostOrigin = `http://${localhostHost}:${ports.next}`,
  callbackOrigin = nextOrigin,
  iceHost = loopbackHost,
} = {}) {
  if (!ports || !authSecret) throw new Error('MediaMTX ports and auth secret are required.')
  const callbackUrl = new URL('/api/internal/mediamtx/authorize', callbackOrigin)
  callbackUrl.searchParams.set('secret', authSecret)

  return `${[
    'logLevel: info',
    'logDestinations: [stdout]',
    'authMethod: http',
    `authHTTPAddress: ${yamlString(callbackUrl.href)}`,
    'api: true',
    `apiAddress: ${loopbackHost}:${ports.api}`,
    'metrics: false',
    'pprof: false',
    'playback: false',
    'rtsp: false',
    'rtmp: true',
    'rtmpEncryption: "no"',
    `rtmpAddress: ${loopbackHost}:${ports.rtmp}`,
    'srt: false',
    'moq: false',
    'hls: true',
    `hlsAddress: ${loopbackHost}:${ports.hls}`,
    'hlsEncryption: false',
    `hlsAllowOrigins: [${yamlString(nextOrigin)}, ${yamlString(localhostOrigin)}]`,
    'hlsAlwaysRemux: true',
    'hlsVariant: lowLatency',
    'hlsSegmentDuration: 2s',
    'hlsPartDuration: 200ms',
    'webrtc: true',
    `webrtcAddress: ${loopbackHost}:${ports.webrtc}`,
    'webrtcEncryption: false',
    `webrtcAllowOrigins: [${yamlString(nextOrigin)}, ${yamlString(localhostOrigin)}]`,
    `webrtcLocalUDPAddress: ${loopbackHost}:${ports.ice}`,
    `webrtcLocalTCPAddress: ${loopbackHost}:${ports.ice}`,
    'webrtcIPsFromInterfaces: false',
    `webrtcAdditionalHosts: [${yamlString(iceHost)}]`,
    'paths:',
    '  live:',
    '    source: publisher',
    '    overridePublisher: true',
    '  "~^channels/[a-z0-9]+(?:-[a-z0-9]+)*$":',
    '    source: publisher',
    '    overridePublisher: true',
  ].join('\n')}\n`
}

export function formatLocalReadyMessage({
  ports,
  username,
  password,
  host = localhostHost,
} = {}) {
  const origin = `http://${host}:${ports.next}`
  return [
    '',
    'Local development stack is ready.',
    `Login URL: ${origin}/login`,
    `OBS server URL: rtmp://${host}:${ports.rtmp}`,
    `Username: ${username}`,
    `Password: ${password}`,
    'Generate a stream key at /account/channel before publishing.',
    'Press Ctrl+C to stop the local stack.',
    '',
  ].join('\n')
}

function commandResult(command, args) {
  try {
    const result = spawnSync(command, args, { stdio: 'ignore' })
    return result.error ? { ok: false, error: result.error } : { ok: result.status === 0 }
  } catch (error) {
    return { ok: false, error }
  }
}

export function prerequisiteErrors({ runner = commandResult } = {}) {
  const errors = []
  const docker = runner('docker', ['info', '--format', '{{.ServerVersion}}'])
  if (docker.error?.code === 'ENOENT') {
    errors.push('Docker is required for dev:local. Install Docker Desktop or Docker Engine.')
  } else if (!docker.ok) {
    errors.push('Docker is installed but not running. Start Docker and retry dev:local.')
  }

  return errors
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return validPort(parsed) ? parsed : fallback
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function waitForHttp(
  url,
  { timeoutMilliseconds = 120_000, intervalMilliseconds = 250, fetcher = fetch } = {},
) {
  const deadline = Date.now() + timeoutMilliseconds
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetcher(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(Math.min(5_000, timeoutMilliseconds)),
      })
      if (response.ok) return response
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await delay(intervalMilliseconds)
  }
  throw new Error(
    `Timed out waiting for ${url}${lastError ? ` (${lastError.message})` : ''}`,
  )
}

function runOneShot(command, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${path.basename(command)} failed${signal ? ` (${signal})` : ` with exit code ${code}`}.`))
    })
  })
}

function trackChild(state, child, label) {
  state.children.push({ child, label })
  child.once('error', (error) => {
    if (!state.stopping) state.rejectUnexpected(new Error(`${label} failed: ${error.message}`))
  })
  child.once('exit', (code, signal) => {
    if (!state.stopping) {
      state.rejectUnexpected(
        new Error(
          `${label} exited unexpectedly${signal ? ` (${signal})` : ` with exit code ${code}`}.`,
        ),
      )
    }
  })
}

function spawnManaged(state, command, args, env, cwd, label) {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
  trackChild(state, child, label)
  return child
}

async function removeManagedContainer(containerName) {
  const inspected = spawnSync(
    'docker',
    [
      'inspect',
      '--format',
      '{{ index .Config.Labels "com.frankerzspam.dev-local" }}',
      containerName,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  )
  if (inspected.status !== 0 || inspected.stdout.trim() !== 'true') return
  spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' })
}

async function stopChildren(state) {
  state.stopping = true
  for (const { child } of [...state.children].reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    child.kill('SIGTERM')
  }
  await Promise.race([
    Promise.all(
      state.children.map(
        ({ child }) =>
          new Promise((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              resolve()
              return
            }
            child.once('exit', resolve)
          }),
      ),
    ),
    delay(10_000),
  ])
  for (const { child } of state.children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
}

function localPortsFromEnvironment() {
  return {
    next: parsePort(process.env.DEV_LOCAL_NEXT_PORT, DEFAULT_LOCAL_PORTS.next),
    rtmp: parsePort(process.env.DEV_LOCAL_RTMP_PORT, DEFAULT_LOCAL_PORTS.rtmp),
    hls: parsePort(process.env.DEV_LOCAL_HLS_PORT, DEFAULT_LOCAL_PORTS.hls),
    webrtc: parsePort(process.env.DEV_LOCAL_WEBRTC_PORT, DEFAULT_LOCAL_PORTS.webrtc),
    api: parsePort(process.env.DEV_LOCAL_API_PORT, DEFAULT_LOCAL_PORTS.api),
    ice: parsePort(process.env.DEV_LOCAL_ICE_PORT, DEFAULT_LOCAL_PORTS.ice),
  }
}

export async function runLocalDevelopment({
  cwd = projectRoot,
  checkPrerequisites = true,
  portDefaults = localPortsFromEnvironment(),
} = {}) {
  if (checkPrerequisites) {
    const errors = prerequisiteErrors()
    if (errors.length > 0) throw new Error(errors.join('\n'))
  }

  loadEnvConfig(cwd)
  const ports = await selectLocalPorts({ defaults: portDefaults })
  const browserOrigin = `http://${localhostHost}:${ports.next}`
  const loopbackOrigin = `http://${loopbackHost}:${ports.next}`
  const localAdmin = localAdminFromEnvironment()
  const authDatabasePath = path.resolve(cwd, '.data/auth.sqlite')
  const thumbnailDirectory = path.resolve(cwd, '.data/thumbnails')
  const internalSecret =
    process.env.INTERNAL_AUTH_SECRET || randomBytes(32).toString('hex')
  const mediaAuthSecret =
    process.env.MEDIAMTX_AUTH_SECRET || randomBytes(32).toString('hex')
  const betterAuthSecret =
    process.env.BETTER_AUTH_SECRET ||
    'development-only-secret-change-before-production'
  const childEnvironment = {
    ...process.env,
    NODE_ENV: 'development',
    AUTH_DB_PATH: authDatabasePath,
    ADMIN_USERNAME: localAdmin.username,
    ADMIN_EMAIL: localAdmin.email,
    ADMIN_PASSWORD: localAdmin.password,
    THUMBNAIL_DIR: thumbnailDirectory,
    BETTER_AUTH_URL: browserOrigin,
    BETTER_AUTH_TRUSTED_ORIGINS: `${browserOrigin},${loopbackOrigin}`,
    BETTER_AUTH_SECRET: betterAuthSecret,
    INTERNAL_AUTH_SECRET: internalSecret,
    MEDIAMTX_AUTH_SECRET: mediaAuthSecret,
    MEDIAMTX_API_URL: `http://${loopbackHost}:${ports.api}`,
    MEDIAMTX_HLS_URL: `http://${loopbackHost}:${ports.hls}`,
    MEDIAMTX_WEBRTC_URL: `http://${loopbackHost}:${ports.webrtc}`,
    MEDIAMTX_RTMP_PORT: String(ports.rtmp),
    MEDIAMTX_ICE_PORT: String(ports.ice),
  }
  await mkdir(path.dirname(authDatabasePath), { recursive: true })
  const configDirectory = await mkdtemp(path.join(cwd, '.data/dev-local-'))
  const configPath = path.join(configDirectory, 'mediamtx.yml')
  const containerName = `mediamtx-viewer-local-${process.pid}-${randomUUID().slice(0, 8)}`
  await writeFile(
    configPath,
    buildMediaMtxConfig({
      ports,
      authSecret: mediaAuthSecret,
      nextOrigin: browserOrigin,
      localhostOrigin: loopbackOrigin,
      callbackOrigin: loopbackOrigin,
    }),
    { mode: 0o600 },
  )

  const state = {
    children: [],
    stopping: false,
    rejectUnexpected: () => undefined,
  }
  state.unexpectedExit = new Promise((_, reject) => {
    state.rejectUnexpected = reject
  })
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  let cleanupStarted = false
  const cleanup = async () => {
    if (cleanupStarted) return
    cleanupStarted = true
    await stopChildren(state)
    await removeManagedContainer(containerName)
    await rm(configDirectory, { recursive: true, force: true })
  }
  const onSignal = () => {
    state.stopping = true
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  try {
    await runOneShot(process.execPath, ['scripts/migrate.mjs'], childEnvironment, cwd)
    await runOneShot(
      process.execPath,
      ['scripts/bootstrap-local-admin.mjs'],
      childEnvironment,
      cwd,
    )

    spawnManaged(
      state,
      npmCommand,
      ['run', 'dev', '--', '--hostname', loopbackHost, '--port', String(ports.next)],
      childEnvironment,
      cwd,
      'Next.js',
    )
    await Promise.race([
      waitForHttp(`${loopbackOrigin}/api/health`),
      state.unexpectedExit,
    ])
    if (state.stopping) return

    spawnManaged(
      state,
      'docker',
      [
        'run',
        '--rm',
        '--name',
        containerName,
        '--label',
        'com.frankerzspam.dev-local=true',
        '--network',
        'host',
        '--volume',
        `${configPath}:/mediamtx.yml:ro`,
        'bluenviron/mediamtx:1.20.1',
      ],
      childEnvironment,
      cwd,
      'MediaMTX',
    )
    await Promise.race([
      waitForHttp(`http://${loopbackHost}:${ports.api}/v3/paths/list`),
      state.unexpectedExit,
    ])
    if (state.stopping) return

    process.stdout.write(
      formatLocalReadyMessage({
        ports,
        username: localAdmin.username,
        password: localAdmin.password,
      }),
    )

    await Promise.race([
      new Promise((resolve) => {
        const check = () => {
          if (state.stopping) resolve()
          else setTimeout(check, 100)
        }
        check()
      }),
      state.unexpectedExit,
    ])
    if (!state.stopping) throw new Error('The local stack stopped unexpectedly.')
  } finally {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    await cleanup()
  }
  return { ports }
}

const executedPath = process.argv[1]
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  runLocalDevelopment().catch((error) => {
    process.stderr.write(`dev:local: ${error instanceof Error ? error.message : error}\n`)
    process.exitCode = 1
  })
}
