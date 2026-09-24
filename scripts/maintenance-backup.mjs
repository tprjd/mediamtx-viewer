import { execFileSync } from 'node:child_process'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { backupKey } from './database-backups.mjs'
import { requireSpace, verifyBackupSet } from './backup-verification.mjs'

const scripts = dirname(fileURLToPath(import.meta.url))
function docker(...args) {
  try {
    return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 16 * 1024 * 1024 }).trim()
  } catch { throw new Error('Docker operation failed') }
}
const inspect = id => JSON.parse(docker('inspect', id))[0]
const envValue = (container, key) => container?.Config.Env.find(value => value.startsWith(`${key}=`))?.slice(key.length + 1)
const service = container => container.Config.Labels['com.docker.compose.service']
const host = (helper, command, value) => JSON.parse(docker('exec', helper, 'node', '/app/scripts/maintenance-host.mjs', command,
  ...(value === undefined ? [] : [JSON.stringify(value)])))
function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('Backup directory must be private, mode 0700')
}
function installation(project) {
  const ids = docker('ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`).split('\n').filter(Boolean)
  const containers = ids.map(inspect).filter(container => !container.Config.Labels['org.frankerzspam.maintenance'])
  const allowed = ['viewer', 'caddy', 'centrifugo', 'mediamtx', 'mediamtx-health', 'thumbnailer', 'discord-notifier']
  if (containers.some(container => !allowed.includes(service(container))) || new Set(containers.map(service)).size !== containers.length) throw new Error('Unsupported installation')
  const viewer = containers.find(container => service(container) === 'viewer')
  const caddy = containers.find(container => service(container) === 'caddy')
  const chat = envValue(viewer, 'CHAT_ENABLED')
  if (!viewer || !caddy || !['true', 'false'].includes(chat)) throw new Error('Missing installation state')
  if (Object.values(caddy.HostConfig.PortBindings ?? {}).some(bindings => bindings?.some(binding => !binding.HostPort || binding.HostPort === '0'))) throw new Error('Public proxy ports must be fixed for recovery')
  if (Object.values(viewer.HostConfig.PortBindings ?? {}).some(bindings => bindings?.length)) throw new Error('Viewer must be private behind Caddy')
  const running = containers.filter(container => container.State.Running)
  if (!running.includes(viewer) || !running.includes(caddy)) throw new Error('Previous release is not running')
  const broker = containers.find(container => service(container) === 'centrifugo')
  if (chat === 'true' ? !broker?.State.Running : broker?.State.Running) throw new Error('Chat state does not match broker state')
  for (const container of containers) {
    if (!container.State.Running && service(container) !== 'centrifugo') throw new Error('Required service is stopped')
    if (container.State.Paused || container.State.Restarting || (container.State.Running && container.State.Health && container.State.Health.Status !== 'healthy')) throw new Error('Previous service is not healthy')
    docker('image', 'inspect', container.Image)
  }
  const authPath = envValue(viewer, 'AUTH_DB_PATH')
  const chatPath = envValue(viewer, 'CHAT_DB_PATH')
  if (!authPath || !chatPath || dirname(authPath) !== dirname(chatPath) ||
      !viewer.Mounts.some(mount => authPath.startsWith(`${mount.Destination}/`) && mount.RW)) throw new Error('Databases must share persistent storage')
  return { containers, viewer, caddy, chatEnabled: chat === 'true' }
}
function configDigest(value) {
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
function caddyFileDigest(id) {
  const directory = mkdtempSync(join(tmpdir(), 'maintenance-config-'))
  try {
    const path = join(directory, 'Caddyfile')
    docker('cp', `${id}:/etc/caddy/Caddyfile`, path)
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
function caddyConfiguration(caddy) {
  if (caddy.Args.includes('--resume') || !caddy.Args.includes('/etc/caddy/Caddyfile')) throw new Error('Unsupported Caddy startup configuration')
  const adapted = JSON.parse(docker('exec', caddy.Id, 'caddy', 'adapt', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'))
  const active = JSON.parse(docker('exec', caddy.Id, 'wget', '-qO-', 'http://127.0.0.1:2019/config/'))
  if (configDigest(adapted) !== configDigest(active)) throw new Error('Caddy startup configuration differs from its active configuration')
  docker('exec', caddy.Id, 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile')
  return configDigest(active)
}
function health(viewer, chatEnabled, version) {
  const health = JSON.parse(docker('exec', viewer, 'node', '-e',
    "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok)process.exit(1);const h=await r.json();console.log(JSON.stringify({status:h.status,version:h.version,chat:h.chat?.status}))}).catch(()=>process.exit(1))"))
  if (health.status !== 'ok' || !health.version || (version && health.version !== version) || health.chat !== (chatEnabled ? 'healthy' : 'disabled')) throw new Error('Release health failed')
  return health.version
}
async function healthy(state) {
  for (let n = 0; n < 30; n++) {
    try {
      for (const previous of state.containers) {
        const current = inspect(previous.id)
        if (current.Image !== previous.image || current.State.StartedAt !== previous.startedAt || current.State.Running !== previous.running || current.State.Paused ||
            (current.State.Running && current.State.Health && current.State.Health.Status !== 'healthy')) throw new Error('Runtime changed')
      }
      health(state.viewer, state.chatEnabled, state.version)
      return
    } catch { await delay(1000) }
  }
  throw new Error('Previous release did not recover')
}
async function maintenanceResponse(url) {
  for (let n = 0; n < 30; n++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (response.status === 503 && (await response.text()) === 'Maintenance in progress. Try again later.') return
    } catch { /* Wait for Caddy to bind its ports. */ }
    await delay(300)
  }
  throw new Error('Static maintenance response failed')
}
function freeze(state) {
  for (const container of state.containers) {
    const current = inspect(container.id)
    if (current.Image !== container.image || current.State.StartedAt !== container.startedAt || current.State.Running !== container.running) throw new Error('Previous container changed')
    if (container.running && !current.State.Paused) docker('pause', container.id)
  }
}
async function resume(helper, state) {
  // Establish a stopped-writer boundary before comparing database fingerprints.
  freeze(state)
  if (caddyFileDigest(state.caddy) !== state.caddyFile) throw new Error('Public proxy startup file changed')
  host(helper, 'unchanged')
  host(helper, 'phase', { phase: 'resuming' })
  try {
    for (const container of state.containers.filter(container => container.running)) docker('unpause', container.id)
    await healthy(state)
    docker('stop', '-t', '2', state.maintenance)
    docker('start', state.caddy)
    const current = inspect(state.caddy)
    if (!current.State.Running || current.Image !== state.caddyImage) throw new Error('Public proxy failed')
    // Exercise the original proxy. Authentication redirects and 401/403 are valid.
    let proxyHealthy = false
    for (let n = 0; n < 30; n++) {
      try {
        const response = await fetch(state.url, { redirect: 'manual', signal: AbortSignal.timeout(2000) })
        if (response.status < 500) { proxyHealthy = true; break }
      } catch { /* Wait for the original Caddy to bind its ports. */ }
      await delay(300)
    }
    if (!proxyHealthy) throw new Error('Public proxy health failed')
    if (caddyConfiguration(inspect(state.caddy)) !== state.caddyConfig) throw new Error('Public proxy configuration changed')
    host(helper, 'release-resume')
    host(helper, 'finish')
  } catch (error) {
    // Health uncertainty never opens public writes.
    try { docker('stop', '-t', '2', state.caddy) } catch { /* Keep recovery evidence. */ }
    try { docker('start', state.maintenance) } catch { /* Report retained maintenance. */ }
    try { freeze(state) } catch { /* Report retained maintenance. */ }
    throw error
  }
  // Cleanup cannot undo a completed healthy recovery or remove its safety marker early.
  for (const id of [state.maintenance, helper]) {
    try { docker('rm', '-f', id) } catch { /* An unused tool container can be removed later. */ }
  }
}

export async function maintenanceBackup({ project, directory, url, hold = false }) {
  backupKey()
  directory = resolve(directory)
  privateDirectory(directory)
  const runtime = installation(project)
  const { viewer, caddy, chatEnabled } = runtime
  const hostKey = Buffer.from(envValue(caddy, 'AUTH_BACKUP_KEY') ?? '', 'base64')
  if (hostKey.length !== 32 || !timingSafeEqual(hostKey, backupKey())) throw new Error('Host and workstation backup keys must match')
  const version = health(viewer.Id, chatEnabled)
  const caddyFile = caddyFileDigest(caddy.Id)
  const caddyConfig = caddyConfiguration(caddy)
  const hostname = envValue(caddy, 'PUBLIC_HOSTNAME')
  if (!hostname || !/^[a-zA-Z0-9.:-]+$/.test(hostname)) throw new Error('Invalid public hostname')
  url ??= `https://${hostname}/`
  const attempt = randomUUID()
  const helper = `maintenance-tool-${attempt}`
  const maintenance = `maintenance-proxy-${attempt}`
  const labels = ['--label', `com.docker.compose.project=${project}`, '--label', `org.frankerzspam.maintenance=${attempt}`]
  const temporary = mkdtempSync(join(tmpdir(), 'maintenance-tools-'))
  let began = false
  let entered = false
  let keep = false
  let state
  let phase = 'preflight'
  try {
    docker('create', '--name', helper, ...labels, '--network', 'none', '--volumes-from', viewer.Id,
      ...['AUTH_DB_PATH', 'CHAT_DB_PATH', 'AUTH_BACKUP_DIR'].flatMap(key => ['-e', `${key}=${envValue(viewer, key) ?? '/data/backups'}`]),
      '-e', 'AUTH_BACKUP_KEY', '--entrypoint', 'node', viewer.Image, '-e', 'setInterval(()=>{},1000)')
    for (const file of ['maintenance-host.mjs', 'database-backups.mjs', 'backup-operation.mjs', 'backup-verification.mjs', 'chat-retention.mjs'])
      docker('cp', join(scripts, file), `${helper}:/app/scripts/${file}`)
    docker('start', helper)
    const measure = host(helper, 'preflight')
    requireSpace(directory, measure.requiredBytes)
    // Reuse the original Caddy image and certificate volumes, but no private env.
    const ports = Object.entries(caddy.HostConfig.PortBindings ?? {}).flatMap(([port, bindings]) =>
      (bindings ?? []).flatMap(binding => ['-p', `${binding.HostIp ? `${binding.HostIp.includes(':') ? `[${binding.HostIp}]` : binding.HostIp}:` : ''}${binding.HostPort}:${port}`]))
    if (!ports.length) throw new Error('No public proxy ports')
    writeFileSync(join(temporary, 'Caddyfile'), `{\n admin off\n persist_config off\n}\n${hostname} {\n header Retry-After 60\n header Cache-Control no-store\n respond "Maintenance in progress. Try again later." 503\n}\n`, { mode: 0o600 })
    docker('create', '--name', maintenance, ...labels, '--restart', 'unless-stopped', '--volumes-from', caddy.Id,
      ...ports, '--entrypoint', 'caddy', caddy.Image, 'run', '--config', '/tmp/maintenance.Caddyfile', '--adapter', 'caddyfile')
    docker('cp', join(temporary, 'Caddyfile'), `${maintenance}:/tmp/maintenance.Caddyfile`)
    state = { attempt, project, helper, maintenance, viewer: viewer.Id, caddy: caddy.Id, caddyImage: caddy.Image, caddyConfig, caddyFile, url, chatEnabled, version,
      containers: runtime.containers.filter(container => container.Id !== caddy.Id).map(container => ({
        id: container.Id, image: container.Image, startedAt: container.State.StartedAt, running: container.State.Running,
      })) }
    host(helper, 'begin', state)
    began = true
    requireSpace(directory, host(helper, 'state').measurement.requiredBytes)
    host(helper, 'phase', { phase: 'entering-maintenance' })
    entered = true
    phase = 'entering-maintenance'
    docker('stop', '-t', '10', caddy.Id)
    docker('start', maintenance)
    await maintenanceResponse(url)
    freeze(state)
    phase = 'snapshot'
    // Recheck space for the frozen database and WAL sizes before copying.
    const snapshot = host(helper, 'snapshot')
    phase = 'transfer'
    const copy = join(directory, attempt)
    privateDirectory(copy)
    requireSpace(copy, snapshot.measurement.requiredBytes)
    for (const file of ['auth.sqlite.enc', 'chat.sqlite.enc', 'manifest.json']) {
      docker('cp', `${helper}:${join(dirname(snapshot.hostManifest), file)}`, join(copy, file))
      chmodSync(join(copy, file), 0o600)
    }
    const workstationManifest = join(copy, 'manifest.json')
    phase = 'workstation-verification'
    const manifest = await verifyBackupSet(workstationManifest)
    state = { ...snapshot, workstationManifest, backupId: manifest.id, phase: 'verified' }
    // This acknowledgement exists only after workstation decryption and validation.
    host(helper, 'phase', { workstationManifest, backupId: manifest.id, phase: 'verified' })
    if (hold) {
      host(helper, 'phase', { phase: 'held' })
      keep = true
      return { ...receipt(state), result: 'verified-maintenance', nextAction: 'Consume the verified phase or run resume with this attempt' }
    }
    phase = 'resuming'
    await resume(helper, state)
    began = false
    return { ...receipt(state), result: 'complete' }
  } catch {
    let result = 'rejected'
    if (began && !entered) {
      try { host(helper, 'cancel-preflight') } catch { keep = true }
    } else if (entered) {
      try {
        const current = host(helper, 'state')
        if (current.phase === 'resuming') throw new Error('Resume requires repair')
        await resume(helper, current)
        result = 'failed-resumed'
      } catch {
        keep = true
        result = 'maintenance-retained'
      }
    }
    throw new Error(JSON.stringify({ attempt, phase, result, nextAction: keep
      ? 'Keep public access closed. Inspect the maintenance marker and containers. Repair the failed check before explicit recovery.'
      : 'Correct the failed backup check and run a new backup.' }))
  } finally {
    rmSync(temporary, { recursive: true, force: true })
    if (!keep) {
      for (const id of [maintenance, helper]) { try { docker('rm', '-f', id) } catch { /* Already removed. */ } }
    }
  }
}
function receipt(state) {
  return { attempt: state.attempt, backupId: state.backupId, hostManifest: state.hostManifest,
    workstationManifest: state.workstationManifest, chatEnabled: state.chatEnabled, version: state.version }
}
async function main() {
  const [command, ...args] = process.argv.slice(2)
  const options = {}
  for (let n = 0; n < args.length; n++) {
    if (args[n] === '--hold') options.hold = true
    else if (['--project', '--directory', '--url', '--attempt'].includes(args[n]) && args[n + 1]) options[args[n].slice(2)] = args[++n]
    else throw new Error('Invalid maintenance option')
  }
  if (!options.project || !/^[a-zA-Z0-9_-]+$/.test(options.project)) throw new Error('Select --project')
  if (command === 'backup' && options.directory) return maintenanceBackup(options)
  if (command === 'resume' && /^[a-f0-9-]{36}$/.test(options.attempt ?? '')) {
    const helper = `maintenance-tool-${options.attempt}`
    const state = host(helper, 'state')
    if (state.project !== options.project || state.attempt !== options.attempt || state.phase !== 'held') throw new Error('No matching verified maintenance phase')
    host(helper, 'claim-resume')
    try {
      await resume(helper, state)
      return { ...receipt(state), result: 'complete' }
    } catch {
      throw new Error(JSON.stringify({ attempt: state.attempt, phase: 'resuming', result: 'maintenance-retained',
        nextAction: 'Keep public access closed. Repair the failed health or unchanged-state check before explicit recovery.' }))
    } finally {
      try { host(helper, 'release-resume') } catch { /* Helper removed after success. */ }
    }
  }
  throw new Error('Usage: maintenance-backup.mjs backup --project NAME --directory PRIVATE_PATH [--url URL] [--hold] | resume --project NAME --attempt ID')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(await main())}\n`) }
  catch (error) {
    console.error(error.message.startsWith('{') ? error.message : JSON.stringify({ result: 'rejected', nextAction: error.message }))
    process.exitCode = 1
  }
}
