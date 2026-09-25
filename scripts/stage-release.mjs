import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { selectedRelease } from './stage-release-source.mjs'
import { validateMediaMtxContract } from './validate-streaming-contract.mjs'

import { assertDeploymentOwner, deploymentStdio } from './deployment-connection.mjs'

const scripts = dirname(fileURLToPath(import.meta.url))
function run(bin, args, options = {}) {
  if (bin === 'docker') assertDeploymentOwner(args)
  try { const result = execFileSync(bin, args, { encoding: 'utf8', stdio: deploymentStdio(), timeout: 120000, maxBuffer: 32 * 1024 ** 2, ...options }); return typeof result === 'string' ? result.trim() : result }
  catch (error) {
    const detail = error.stderr?.toString().trim()
    if (/^(Host (measurement|memory|bytes)|Runtime storage|Database integrity|Chat runtime)[A-Za-z0-9 ()_-]*$/.test(detail ?? '')) throw new Error(detail)
    throw new Error(`${bin === 'docker' ? 'Docker' : bin === 'git' ? 'Release source download' : 'Configuration'} operation failed`) }
}
function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077) throw new Error('Workstation staging directory must have mode 0700')
}
function workstationSpace(path, bytes, files) {
  const fs = statfsSync(path)
  const available = fs.bavail * fs.bsize
  if (![available, bytes, fs.files, fs.ffree].every(Number.isSafeInteger) || available < bytes || fs.files <= 0 || fs.ffree < files) throw new Error('Workstation bytes or inodes are insufficient or unknown')
}
function treeSize(path) {
  let bytes = 0, files = 0
  for (const name of readdirSync(path)) {
    const child = join(path, name), stat = lstatSync(child)
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('Release configuration must contain only regular files and directories')
    if (stat.isDirectory()) { const size = treeSize(child); bytes += size.bytes; files += size.files }
    else { chmodSync(child, 0o600); bytes += stat.size; files++ }
  }
  chmodSync(path, 0o700)
  return { bytes, files }
}
const service = container => container.Config.Labels?.['com.docker.compose.service']
const envValue = (container, key) => container.Config.Env?.find(value => value.startsWith(`${key}=`))?.slice(key.length + 1)

async function main() {
  const [action, target, ...args] = process.argv.slice(2)
  const tag = action === 'prepare' ? args.shift() : undefined
  let project = 'mediamtx-viewer', directory = join(homedir(), '.local/share/mediamtx-deployments')
  while (args.length) {
    const key = args.shift(), value = args.shift()
    if (key === '--project' && value) project = value
    else if (key === '--directory' && value) directory = resolve(value)
    else throw new Error('Unknown staging option')
  }
  if (!['prepare', 'status'].includes(action) || !/^[a-zA-Z0-9_@.:-]+$/.test(target ?? '') || target.startsWith('-') || !/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error('Usage: deploy.sh prepare TARGET TAG | status TARGET [--project NAME] [--directory PATH]')
  const record = action === 'prepare' ? await selectedRelease(tag) : null
  try { return await stageOrStatus({ action, target, record, tag, project, directory }) }
  catch (error) {
    error.report ??= { project, release: record?.tag, commit: record?.commit, images: record?.images, result: 'rejected', phase: 'preflight', reason: safeReason(error),
      nextAction: 'Repair the reported failure and prepare again.' }
    throw error
  }
}

export async function stageOrStatus({ action, target, record, tag, project, directory, deploymentAttempt, onState = () => {} }) {
  const endpoint = target === 'local' ? process.env.DOCKER_HOST || JSON.parse(run('docker', ['context', 'inspect']))[0].Endpoints.docker.Host : `ssh://${target}`
  const docker = (...args) => run('docker', ['--host', endpoint, ...args])
  const inspect = id => JSON.parse(docker('inspect', id))[0]
  const volume = `${project}-deployment-staging`, lock = `${project}-stage-operation`
  const ids = docker('ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`).split('\n').filter(Boolean)
  const containers = ids.map(inspect)
  const viewer = containers.find(container => service(container) === 'viewer') ||
    (action === 'status' && docker('ps', '-aq', '--filter', `name=^/${project}-deploy-operation$`) ? inspect(`${project}-deploy-operation`) : null)
  if (!viewer) throw new Error('Existing viewer is missing')
  if (action === 'status') {
    const deployment = docker('ps', '-aq', '--filter', `name=^/${project}-deploy-operation$`)
    try {
      docker('volume', 'inspect', volume)
      let saved = JSON.parse(docker('run', '--rm', '--user', '0', '--network', 'none', '--mount', `type=volume,source=${volume},target=/stage,readonly`, '--entrypoint', 'cat', viewer.Image, '/stage/deployment-status.json'))
      if (deployment) {
        const bootstrap = JSON.parse(inspect(deployment).Config.Labels['org.frankerzspam.deployment-state'] || '{}')
        if (bootstrap.attempt && saved.attempt !== bootstrap.attempt && (saved.phase === 'complete' || saved.result === 'rejected')) saved = bootstrap
      }
      let owner = 'none'
      if (deployment) {
        owner = inspect(deployment).State.Running
          ? docker('exec', deployment, 'sh', '-c', 'flock -n /stage/operation.lock -c "echo abandoned" || echo active')
          : 'abandoned'
      }
      const resolved = ['active', 'recovered', 'failed-rolled-back', 'rejected'].includes(saved.result) && saved.phase === 'complete'
      if (!resolved && owner === 'none') owner = 'abandoned'
      const result = !resolved && owner === 'abandoned' && !['maintenance-required', 'rejected'].includes(saved.result) ? 'interrupted' : saved.result
      let observedMigrations = { auth: null, chat: null }
      try {
        observedMigrations = JSON.parse(docker('run', '--rm', '--network', 'none', '--volumes-from', viewer.Id,
          '--entrypoint', 'node', viewer.Image, '--input-type=module', '-e', readFileSync(join(scripts, 'deployment-databases.mjs'), 'utf8'),
          JSON.stringify({ paths: { auth: envValue(viewer, 'AUTH_DB_PATH'), chat: envValue(viewer, 'CHAT_DB_PATH') } })))
      } catch { /* Missing or unreadable records are unknown, never an empty history. */ }
      const observedServices = containers.filter(c => !c.Config.Labels['org.frankerzspam.maintenance']).map(c => ({ service: service(c), id: c.Id, image: c.Image, running: c.State.Running, paused: c.State.Paused, restarting: c.State.Restarting }))
      return { ...saved, result, owner, observedMigrations, observedServices, operationHeld: Boolean(deployment),
        nextAction: owner === 'active' ? 'Wait for the active operation. Recovery cannot take its lock.'
          : !resolved && deployment ? 'Inspect both database histories and protected files. Run recover with an explicit release and database choice.' : saved.nextAction }

    } catch {
      if (deployment) {
        const container = inspect(deployment)
        const owner = container.State.Running ? docker('exec', deployment, 'sh', '-c', 'flock -n /stage/operation.lock -c "echo abandoned" || echo active') : 'abandoned'
        return { ...JSON.parse(container.Config.Labels['org.frankerzspam.deployment-state'] || '{}'), project, owner,
          result: owner === 'active' ? 'in-progress' : 'interrupted',
          nextAction: owner === 'active' ? 'Wait for the active operation.' : 'Recover the original attempt with previous release and no database restore.' }
      }
    }
    const readStatus = () => {
      // Never create a volume while reading status.
      docker('volume', 'inspect', volume)
      return JSON.parse(docker('run', '--rm', '--user', '0', '--network', 'none', '--mount', `type=volume,source=${volume},target=/stage,readonly`, '--entrypoint', 'cat', viewer.Image, '/stage/status.json'))
    }
    const active = docker('ps', '-aq', '--filter', `name=^/${lock}$`)
    if (active) {
      let state = JSON.parse(inspect(active).Config.Labels?.['org.frankerzspam.staging-state'] || '{}')
      try {
        const saved = readStatus()
        if (state.attempt && saved.attempt === state.attempt) state = saved
      } catch { /* A disconnect can occur before the first status write. */ }
      return { ...state, project, result: 'in-progress-or-interrupted', nextAction: 'Inspect the staging owner. Do not remove its lock while preparation is running.' }
    }
    return readStatus()
  }
  const deploymentOwner = docker('ps', '-aq', '--filter', `name=^/${project}-deploy-operation$`)
  if (deploymentOwner) {
    const saved = JSON.parse(docker('exec', deploymentOwner, 'cat', '/stage/deployment-status.json'))
    if (!deploymentAttempt || saved.attempt !== deploymentAttempt) throw new Error('Unresolved managed deployment blocks preparation')
  }
  const names = ['viewer', 'caddy', 'centrifugo', 'mediamtx', 'mediamtx-health', 'thumbnailer', 'discord-notifier']
  if (containers.length !== names.length || names.some(name => containers.filter(container => service(container) === name).length !== 1)) throw new Error('Existing service state is incomplete or unsupported')
  const chat = envValue(viewer, 'CHAT_ENABLED')
  if (!['true', 'false'].includes(chat)) throw new Error('Existing Chat state is unknown')
  for (const container of containers) {
    const running = service(container) !== 'centrifugo' || chat === 'true'
    if (container.State.Running !== running || container.State.Paused || container.State.Restarting ||
        (running && container.State.Health && container.State.Health.Status !== 'healthy')) throw new Error('Existing service state is unhealthy')
    docker('image', 'inspect', container.Image)
  }
  const health = JSON.parse(docker('exec', viewer.Id, 'node', '-e',
    "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok)process.exit(1);const h=await r.json();console.log(JSON.stringify({status:h.status,version:h.version,chat:h.chat?.status}))}).catch(()=>process.exit(1))"))
  if (health.status !== 'ok' || !health.version || health.chat !== (chat === 'true' ? 'healthy' : 'disabled')) throw new Error('Existing release health failed')
  const info = JSON.parse(docker('info', '--format', '{{json .}}'))
  if (!['aarch64', 'arm64'].includes(info.Architecture) || info.OSType !== 'linux' || !info.DockerRootDir?.startsWith('/')) throw new Error('Target must be a Linux ARM64 Docker host')
  const databases = { auth: envValue(viewer, 'AUTH_DB_PATH'), chat: envValue(viewer, 'CHAT_DB_PATH') }
  if (Object.values(databases).some(path => !path?.startsWith('/') || !viewer.Mounts.some(mount => mount.Type === 'volume' && path.startsWith(`${mount.Destination}/`)))) throw new Error('Existing database volumes are unknown')
  if (docker('ps', '-aq', '--filter', `name=^/${lock}$`)) throw new Error('Staging operation lock is held. Inspect status before recovery.')
  privateDirectory(directory)
  workstationSpace(directory, 256 * 1024 ** 2, 10000)
  const work = mkdtempSync(join(directory, '.prepare-'))
  const attempt = randomUUID()
  const state = { attempt, project, startedAt: new Date().toISOString(), verificationFinishedAt: record.verification.finishedAt, release: record.tag, commit: record.commit, images: record.images, chatEnabled: chat === 'true', result: 'preparing', phase: 'source', nextAction: 'Wait for preparation to complete.' }
  const temporaryContainers = []
  let owned = false
  try {
    // Atomic Docker name allocation is the host-side operation lock. A lost client leaves it in place.
    docker('create', '--name', lock, '--label', `org.frankerzspam.staging=${project}`, '--label', `org.frankerzspam.deployment-attempt=${deploymentAttempt ?? ''}`, '--label', `org.frankerzspam.staging-state=${JSON.stringify(state)}`, '--network', 'none', '--user', '0',
      '--volumes-from', `${viewer.Id}:ro`, '--mount', `type=volume,source=${volume},target=/stage`,
      '--mount', `type=bind,source=${info.DockerRootDir},target=/docker-storage,readonly`, '--entrypoint', 'node', viewer.Image, '-e', 'setInterval(()=>{},1000)')
    owned = true
    // Resolve native SQLite from the existing image, not from the workstation.
    docker('cp', join(scripts, 'stage-host.mjs'), `${lock}:/app/stage-host.mjs`)
    docker('start', lock)
    // /app is the application's package root and contains better-sqlite3.
    const checkedHost = (action, value) => JSON.parse(docker('exec', lock, 'node', '/app/stage-host.mjs', action, JSON.stringify(value)))
    const save = () => { onState(state); return checkedHost('save', state) }
    save()
    const source = join(work, 'source')
    run('git', ['init', '-q', source])
    const git = (...args) => run('git', ['-C', source, ...args])
    git('fetch', '--depth=1', `https://github.com/${record.repository}.git`, `refs/tags/${record.tag}:refs/tags/${record.tag}`)
    if (git('rev-parse', `refs/tags/${tag}`) !== record.tagObject || git('rev-parse', `refs/tags/${tag}^{commit}`) !== record.commit) throw new Error('Downloaded release tag moved')
    git('checkout', '--detach', record.commit)
    if (JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version !== record.version ||
        run(process.execPath, [realpathSync(join(source, 'scripts/chat-capacity/source.mjs'))], { cwd: source }) !== record.sourceFingerprint) throw new Error('Downloaded source or version mismatched')
    rmSync(join(source, '.git'), { recursive: true })
    treeSize(source)
    const secrets = join(source, 'deploy/oracle/secrets')
    privateDirectory(secrets)
    for (const name of ['caddy.env', 'admin.env', 'mediamtx.yml', 'oci-usage.env', 'oci-usage-api-key.pem', 'discord.env', 'credentials.txt']) {
      const value = run('sops', ['decrypt', '--input-type', 'binary', join(source, 'deploy/oracle/secrets.enc', `${name}.enc`)],
        { encoding: null, env: { ...process.env, SOPS_AGE_KEY_FILE: process.env.SOPS_AGE_KEY_FILE || join(homedir(), '.config/sops/age/keys.txt') } })
      if (!value.length) throw new Error('Required release secret is empty')
      writeFileSync(join(secrets, name), value, { mode: 0o600, flag: 'wx' })
    }
    const contract = JSON.parse(readFileSync(join(source, 'config/streaming-contract.v1.json'), 'utf8'))
    if (validateMediaMtxContract(contract, readFileSync(join(secrets, 'mediamtx.yml'), 'utf8')).length) throw new Error('Streaming contract validation failed')
    state.phase = 'configuration'; save()
    const composeEnv = { PATH: process.env.PATH, HOME: process.env.HOME, CHAT_ENABLED: chat, SOURCE_FINGERPRINT: record.sourceFingerprint }
    const model = JSON.parse(run('docker', ['compose', '--project-name', project, '--env-file', join(secrets, 'caddy.env'), '-f', join(source, 'deploy/oracle/docker-compose.yml'), 'config', '--format', 'json'], { env: composeEnv }))
    for (const name of ['viewer', 'thumbnailer']) { delete model.services[name].build; model.services[name].image = record.images[name] }
    if (model.name !== project || Object.keys(model.services).sort().join() !== names.sort().join()) throw new Error('Unsupported Compose model')
    const viewerEnv = model.services.viewer.environment
    for (const key of ['BETTER_AUTH_SECRET', 'INTERNAL_AUTH_SECRET', 'MEDIAMTX_AUTH_SECRET', 'CENTRIFUGO_API_KEY', 'CENTRIFUGO_TOKEN_HMAC_SECRET', 'CHAT_TAG_HMAC_SECRET']) {
      if (!viewerEnv[key]) throw new Error('Required application secret is missing')
    }
    for (const key of ['CHAT_DATABASE_LIMIT_BYTES', 'CHAT_MINIMUM_FREE_BYTES']) {
      const current = envValue(viewer, key)
      if (current !== undefined) viewerEnv[key] = current
    }
    if (viewerEnv.AUTH_DB_PATH !== databases.auth || viewerEnv.CHAT_DB_PATH !== databases.chat) throw new Error('Database paths must match the existing installation')
    for (const [name, definition] of Object.entries(model.volumes ?? {})) {
      const expected = definition.name
      const mounts = containers.flatMap(container => container.Mounts).filter(mount => mount.Type === 'volume' && mount.Name === expected)
      if (!mounts.length) throw new Error('Persistent volume identity does not match the existing installation')
      model.volumes[name] = { name: expected, external: true }
    }
    const stageRoot = JSON.parse(docker('volume', 'inspect', volume))[0].Mountpoint
    const destination = `${stageRoot}/${attempt}/source`
    for (const [name, config] of Object.entries(model.services)) for (const mount of config.volumes ?? []) {
      if (mount.type === 'volume') {
        const previous = containers.find(container => service(container) === name)
        if (!previous.Mounts.some(current => current.Type === 'volume' && current.Destination === mount.target && current.Name === model.volumes[mount.source]?.name)) throw new Error('Persistent volume identity differs at a service mount')
      }
      if (mount.type === 'bind') {
        if (!mount.source.startsWith(`${source}/`)) throw new Error('Release bind mount escapes staging')
        lstatSync(mount.source)
        mount.source = destination + mount.source.slice(source.length)
      }
    }
    writeFileSync(join(source, 'resolved-compose.json'), JSON.stringify(model), { mode: 0o600 })
    writeFileSync(join(source, 'release.json'), JSON.stringify(record), { mode: 0o600 })
    const size = treeSize(source)
    let imageBytes = 0
    const dockerConfig = join(work, 'docker')
    privateDirectory(dockerConfig)
    // Reserve four times the compressed layer bytes, plus a second measurement after extraction.
    for (const reference of [...new Set(Object.values(model.services).map(config => config.image))]) {
      const manifest = JSON.parse(docker('--config', dockerConfig, 'manifest', 'inspect', reference))
      let layers = manifest.layers
      if (manifest.manifests) {
        const arm = manifest.manifests.find(item => item.platform?.os === 'linux' && item.platform?.architecture === 'arm64')
        if (!arm) throw new Error('Image has no Linux ARM64 manifest')
        const base = reference.split('@')[0].replace(/:[^/:]+$/, '')
        layers = JSON.parse(docker('--config', dockerConfig, 'manifest', 'inspect', `${base}@${arm.digest}`)).layers
      }
      if (!layers?.length || layers.some(layer => !Number.isSafeInteger(layer.size) || layer.size <= 0)) throw new Error('Image storage measurement failed')
      imageBytes += layers.reduce((sum, layer) => sum + layer.size, 0) * 4
    }
    const budget = { databases, stageBytes: size.bytes * 2 + 64 * 1024 ** 2, files: size.files,
      imageBytes, minimumFreeBytes: Number(viewerEnv.CHAT_MINIMUM_FREE_BYTES), databaseLimitBytes: Number(viewerEnv.CHAT_DATABASE_LIMIT_BYTES) }
    state.phase = 'host-checks'; save()
    const measureHost = () => {
      const database = JSON.parse(docker('exec', '-w', '/app', viewer.Id, 'node', '--input-type=module', '-e', readFileSync(join(scripts, 'stage-databases.mjs'), 'utf8'), JSON.stringify(budget)))
      return checkedHost('check', { ...budget, ...database })
    }
    let measure = measureHost()
    workstationSpace(work, measure.backupBytes + budget.stageBytes, size.files * 2 + 10000)
    state.requiredImages = Object.values(model.services).map(config => config.image)
    state.phase = 'images'; save()
    let viewerOwner
    for (const [name, config] of Object.entries(model.services)) {
      docker('--config', dockerConfig, 'pull', '--platform', 'linux/arm64', config.image)
      const image = JSON.parse(docker('image', 'inspect', config.image))[0]
      if (image.Os !== 'linux' || image.Architecture !== 'arm64' || !Number.isSafeInteger(image.Size) || image.Size <= 0) throw new Error('Image architecture or size verification failed')
      if (record.images[name]) {
        if (!image.RepoDigests?.includes(record.images[name]) || image.Config.Labels?.['org.opencontainers.image.revision'] !== record.commit || image.Config.Labels?.['org.frankerzspam.source'] !== record.sourceFingerprint) throw new Error('Image digest or source verification failed')
      }
      if (name === 'viewer') {
        viewerOwner = JSON.parse(docker('run', '--rm', '--network', 'none', ...(config.user ? ['--user', String(config.user)] : []), '--label', `org.frankerzspam.staging=${project}`, '--entrypoint', 'node', config.image,
          '-e', 'console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid()}))'))
        if (![viewerOwner.uid, viewerOwner.gid].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Viewer file ownership is unknown')
      }
      config.image = image.RepoDigests?.find(ref => ref.startsWith(config.image.split('@')[0].replace(/:[^/:]+$/, '') + '@')) || image.Id
      state.requiredImages = Object.values(model.services).map(config => config.image)
      save()
    }
    // Downloaded images now consume measured free space. Do not reserve them twice.
    budget.imageBytes = 0
    measure = measureHost()
    workstationSpace(work, measure.backupBytes + budget.stageBytes, size.files * 2 + 10000)
    writeFileSync(join(source, 'resolved-compose.json'), JSON.stringify(model), { mode: 0o600 })
    docker('cp', source, `${lock}:/stage/${attempt}/source`)
    // A private bind-mounted key must remain readable by the candidate's runtime user.
    docker('exec', lock, 'node', '-e', 'require("fs").chownSync(process.argv[1],Number(process.argv[2]),Number(process.argv[3]))',
      `/stage/${attempt}/source/deploy/oracle/secrets/oci-usage-api-key.pem`, String(viewerOwner.uid), String(viewerOwner.gid))
    state.phase = 'isolated-validation'; save()
    const validate = (name, entrypoint, args, file, targetFile) => {
      const id = `${project}-validate-${name}-${attempt}`
      temporaryContainers.push(id)
      const config = model.services[name]
      const environment = { ...config.environment, ...(name === 'mediamtx' ? { MTX_UDPREADBUFFERSIZE: '0' } : {}) }
      const lines = Object.entries(environment).map(([key, value]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /[\r\n]/.test(String(value ?? ''))) throw new Error('Validation environment requires single-line values')
        return `${key}=${value ?? ''}`
      })
      const environmentFile = join(work, `validate-${name}.env`)
      writeFileSync(environmentFile, lines.join('\n') + '\n', { mode: 0o600, flag: 'wx' })
      docker('create', '--name', id, '--label', `org.frankerzspam.staging=${project}`, '--network', 'none',
        '--env-file', environmentFile, '--entrypoint', entrypoint, config.image, ...args)
      docker('cp', file, `${id}:${targetFile}`)
      docker('start', id)
      return id
    }
    const caddy = validate('caddy', 'caddy', ['validate', '--config', '/tmp/staged.Caddyfile', '--adapter', 'caddyfile'], join(source, 'deploy/oracle/Caddyfile'), '/tmp/staged.Caddyfile')
    if (docker('wait', caddy) !== '0') throw new Error('Caddy configuration validation failed')
    const media = validate('mediamtx', '/mediamtx', ['/mediamtx.yml'], join(secrets, 'mediamtx.yml'), '/mediamtx.yml')
    await delay(3000)
    if (!inspect(media).State.Running) throw new Error('MediaMTX syntax validation failed')
    for (const previous of containers) {
      const current = inspect(previous.Id)
      if (current.Image !== previous.Image || current.State.StartedAt !== previous.State.StartedAt || current.State.Running !== previous.State.Running || current.State.Paused) throw new Error('Existing service state changed during staging')
    }
    // Recheck tag and evidence freshness before publishing readiness.
    const finalRecord = await selectedRelease(tag)
    if (['format', 'tag', 'version', 'repository', 'commit', 'tagObject', 'sourceFingerprint'].some(key => finalRecord[key] !== record[key]) || ['viewer', 'thumbnailer'].some(name => finalRecord.images[name] !== record.images[name])) throw new Error('Release identity changed during preparation')
    state.result = 'ready'; state.preparedAt = new Date().toISOString(); state.phase = 'prepared'; state.stagingVolume = volume
    state.nextAction = 'Prepared only. Use the opt-in managed deployment command with a verified managed baseline to activate.'
    save()
    return state
  } catch (error) {
    if (owned) {
      state.result = 'rejected'; state.reason = safeReason(error); state.nextAction = 'Repair the reported failure and prepare again. Active services were not changed.'
      try { docker('exec', lock, 'node', '/app/stage-host.mjs', 'save', JSON.stringify(state)) } catch { /* Keep the lock if the result cannot be recorded. */ owned = false }
    }
    throw Object.assign(new Error(`Preparation failed during ${state.phase}: ${safeReason(error)}`), { report: { ...state, result: 'rejected', reason: safeReason(error) } })
  } finally {
    for (const id of temporaryContainers) { try { docker('rm', '-f', '-v', id) } catch { /* Isolated validation container only. */ } }
    if (owned) { try { docker('rm', '-f', lock) } catch { /* A retained lock blocks the next attempt. */ } }
    rmSync(work, { recursive: true, force: true })
  }
}
function safeReason(error) { return error instanceof SyntaxError ? 'Malformed release or configuration data' : error.code ? 'File or host operation failed' : error.message }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const report = await main(); console.log(JSON.stringify(report)); if (process.argv[2] === 'status' && !['active', 'recovered', 'ready'].includes(report.result)) process.exitCode = 1 }
  catch (error) { console.error(JSON.stringify(error.report || { result: 'rejected', release: /^v\d+\.\d+\.\d+$/.test(process.argv[4] ?? '') ? process.argv[4] : undefined, reason: safeReason(error) })); process.exitCode = 1 }
}
