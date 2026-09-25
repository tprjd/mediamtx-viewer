import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, constants, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { stageOrStatus } from './stage-release.mjs'
import { selectedRelease } from './stage-release-source.mjs'
import { maintenanceBackup, caddyConfiguration, acknowledgeBackup } from './maintenance-backup.mjs'
import { verifyProxy } from './deployment-proxy.mjs'
import { runtimeIdentity } from './deployment-state.mjs'
import { applicationHealth, applicationAccepted, changeChat, chatHealth, chatModel } from './deployment-chat.mjs'
import { cancelChatTrial } from './cancel-chat-trial.mjs'
import { cleanupDeployment } from './deployment-cleanup.mjs'
import { requireSpace } from './backup-verification.mjs'
import { adoptedRecoveryRuntime } from './adoption-model.mjs'
import { adoptInstallation, verifyAdoptedFiles } from './adopt-installation.mjs'

import { assertDeploymentOwner, setDeploymentOwner, ownerProgram, deploymentStdio } from './deployment-connection.mjs'

const scripts = dirname(fileURLToPath(import.meta.url))
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
function recoveryIdentity(runtime, privatePorts = false) {
  const value = structuredClone(runtime)
  delete value.config.Hostname
  // Docker changes this nullable default when a created broker first starts.
  value.host.OomKillDisable ??= false
  // Compose adds per-instance labels when it recreates a container. Keep project
  // and service ownership; compare the actual image, environment, and mounts below.
  for (const key of Object.keys(value.config.Labels)) {
    if (key.startsWith('com.docker.compose.') && !['com.docker.compose.project', 'com.docker.compose.service'].includes(key)) delete value.config.Labels[key]
  }
  for (const bindings of Object.values(value.host.PortBindings ?? {})) {
    for (const binding of bindings ?? []) binding.HostIp ||= '0.0.0.0'
    bindings?.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  if (privatePorts) {
    delete value.config.ExposedPorts
    delete value.host.PortBindings
  }
  value.config.Env?.sort()
  value.host.Binds?.sort()
  value.host.Mounts?.sort((a, b) => a.Target.localeCompare(b.Target))
  return value
}
const portIdentity = ports => (ports ?? []).map(port => ({ target: port.target, published: String(port.published), protocol: port.protocol || 'tcp', host_ip: port.host_ip || '0.0.0.0', mode: port.mode || 'ingress' })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
function docker(...args) {
  assertDeploymentOwner(args)
  try { return execFileSync('docker', args, { encoding: 'utf8', stdio: deploymentStdio(), timeout: 120000, maxBuffer: 32 * 1024 ** 2 }).trim() }
  catch { throw new Error('Docker deployment operation failed') }
}
const service = c => c.Config.Labels?.['com.docker.compose.service']
const env = (c, name) => c.Config.Env?.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1)
function containers(project) {
  const ids = docker('ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`).split('\n').filter(Boolean)
  return ids.length ? JSON.parse(docker('inspect', ...ids)).filter(c => !c.Config.Labels['org.frankerzspam.maintenance']) : []
}

async function deploy({ target, tag, project, directory, url, recovery, restore, confirm, chatAction, cleanup, adopt }) {
  if (target !== 'local') process.env.DOCKER_HOST = `ssh://${target}`
  const volume = `${project}-deployment-staging`, tool = `${project}-deploy-operation`
  if (adopt) docker('volume', 'create', volume)
  try { docker('volume', 'inspect', volume) } catch { throw new Error('A verified managed baseline is required. Complete managed adoption before deployment.') }
  const initial = containers(project), viewer = initial.find(c => service(c) === 'viewer')
  if (!viewer) throw new Error('Managed viewer is missing')
  if (chatAction === 'health') {
    const current = JSON.parse(docker('run', '--rm', '--user', '0', '--network', 'none', '-v', `${volume}:/stage:ro`, '--entrypoint', 'cat', viewer.Image, '/stage/current.json'))
    const report = chatHealth(docker, initial, current)
    if (!report.accepted) process.exitCode = 1
    return report
  }
  const info = JSON.parse(docker('info', '--format', '{{json .}}'))
  let attempt = randomUUID()
  const work = mkdtempSync(join(tmpdir(), 'deploy-release-'))
  let state = { attempt, project, release: tag, phase: adopt ? 'adopting' : 'baseline', result: 'in-progress', capacity: 'unverified',
    ...(adopt ? { adoptionSource: '/stage/baseline/source', adoptionImages: initial.map(container => container.Image), chatLock: { attempt, directory: env(viewer, 'AUTH_BACKUP_DIR') || '/data/backups', authPath: env(viewer, 'AUTH_DB_PATH') } } : {}) }
  let connection, connectionFd, preserveState = false
  let owned = false, chatLocked = false, backupReceipt, previous, migrationBaseline, activeModel, staged, retained = false, ownershipRecorded = false, acceptanceHistory, migrationProcess
  const createTool = () => {
    docker('create', '--name', tool, '--label', `org.frankerzspam.deployment=${project}`, '--label', `org.frankerzspam.deployment-state=${JSON.stringify(state)}`, '--network', 'none', '--user', '0',
      '--volumes-from', viewer.Id, '-v', `${volume}:/stage`, '--mount', `type=bind,source=${info.DockerRootDir},target=/docker-storage,readonly`, '--entrypoint', 'node', viewer.Image, '-e', 'setInterval(()=>{},1000)')
    docker('start', tool)
  }
  const claim = () => new Promise((resolve, reject) => {
    const token = randomUUID()
    const pipe = join(work, 'connection')
    execFileSync('mkfifo', [pipe])
    connectionFd = openSync(pipe, constants.O_RDWR)
    const input = openSync(pipe, constants.O_RDONLY)
    connection = spawn('docker', ['exec', '-i', tool, 'flock', '-n', '/stage/operation.lock', 'node', '--input-type=module', '-e', ownerProgram, 'hold', token], { stdio: [input, 'pipe', 'pipe'] })
    closeSync(input)
    connection.once('error', reject)
    connection.once('exit', () => reject(new Error('Managed operation has an active owner')))
    connection.stdout.once('data', data => {
      if (data.toString().trim() !== 'owned') return reject(new Error('Managed ownership is uncertain'))
      setDeploymentOwner({ tool, token, input: connectionFd })
      owned = true
      try {
        for (const file of ['deployment-state.mjs', 'backup-operation.mjs', 'deployment-databases.mjs', 'stage-host.mjs']) docker('cp', join(scripts, file), `${tool}:/app/${file}`)
        for (const file of ['deployment-retention.mjs', 'deployment-state.mjs', 'backup-verification.mjs', 'database-backups.mjs', 'backup-operation.mjs', 'chat-retention.mjs']) docker('cp', join(scripts, file), `${tool}:/app/scripts/${file}`)
        resolve()
      } catch (error) { retained = true; preserveState = true; reject(error) }
    })
  })
  const host = (action, value) => {
    // New backup directories must belong to the viewer, not the root tool.
    // Root may inspect an existing interrupted lock before deciding ownership.
    const freshChatLock = action === 'chat-lock' && (!value.resume || !host('exists', { path: `${value.directory}/.backup-lock` }).exists)
    return JSON.parse(docker('exec', ...(freshChatLock ? ['--user', viewer.Config.User || '0'] : []), tool,
      'node', '/app/deployment-state.mjs', action, JSON.stringify(value)))
  }
  const save = (path, value) => {
    const file = join(work, 'state.json')
    writeFileSync(file, JSON.stringify({ path, value }), { mode: 0o600 })
    docker('cp', file, `${tool}:/app/deployment-input.json`)
    return JSON.parse(docker('exec', tool, 'node', '/app/deployment-state.mjs', 'save', '@/app/deployment-input.json'))
  }
  const read = path => host('read', { path })
  const clean = record => cleanupDeployment({ docker, tool, directory, authPath: env(viewer, 'AUTH_DB_PATH'), read, save, attempt, record })
  const resumeChatLock = () => {
    if (!state.chatLock) return
    try { host('chat-lock', { ...state.chatLock, resume: true }) }
    catch { preserveState = true; throw new Error('Managed Chat backup lock unavailable') }
    retained = true
  }
  const phase = value => {
    state.phase = value
    state.protection = { unresolved: !['complete', 'rejected'].includes(value), stagingVolume: volume,
      sources: [state.adoptionSource, state.previousRelease?.source, state.candidateRelease?.source, state.staging?.source].filter(Boolean),
      images: [...new Set([...(state.adoptionImages ?? []), ...Object.values(previous?.model?.services ?? {}).map(config => config.image), ...Object.values(activeModel?.services ?? {}).map(config => config.image), ...Object.values(state.staging?.images ?? {})])],
      backups: state.backup ? [state.backup] : [] }
    save(`/stage/deployments/${attempt}.json`, state)
    save('/stage/deployment-status.json', state)
  }
  const finish = source => {
    state.completion = { source }
    phase('completion')
    maintenance('finish')
  }
  const compose = (model, ...args) => {
    const file = join(work, 'compose.json')
    writeFileSync(file, JSON.stringify(model), { mode: 0o600 })
    return docker('compose', '--project-name', project, '-f', file, ...args)
  }
  const maintenance = (action, value = { attempt: backupReceipt.attempt }) => JSON.parse(docker('exec', `maintenance-tool-${backupReceipt.attempt}`, 'node', '/app/scripts/maintenance-host.mjs', action, ...(value ? [JSON.stringify(value)] : [])))
  const databaseState = (requireDrained = false, validation = {}) => JSON.parse(docker('exec', tool, 'node', '/app/deployment-databases.mjs', JSON.stringify({
    requireDrained, paths: { auth: env(viewer, 'AUTH_DB_PATH'), chat: env(viewer, 'CHAT_DB_PATH') }, ...validation,
  })))
  const checkHistory = (requireDrained = false) => { if (!same(databaseState(requireDrained), acceptanceHistory ?? migrationBaseline)) throw new Error('Database migration history changed or is uncertain') }
  const observe = () => {
    const after = databaseState()
    state.migrationChanges = Object.fromEntries(['auth', 'chat'].map(name => [name, {
      known: after[name] !== null,
      added: after[name]?.filter(row => !migrationBaseline[name].some(old => old.name === row.name)).map(row => row.name) ?? [],
      changed: after[name] === null || migrationBaseline[name].some(old => !after[name].some(row => same(row, old))),
    }]))
    return after
  }
  const stopMigration = () => {
    if (!migrationProcess) return
    const id = docker('ps', '-aq', '--filter', `name=^/${migrationProcess}$`)
    if (id) {
      let current = JSON.parse(docker('inspect', id))[0]
      if (current.State.Running) docker('kill', id)
      current = JSON.parse(docker('inspect', id))[0]
      if (current.State.Running || current.State.Restarting) throw new Error('Database migration process completion is uncertain')
      docker('rm', id)
    }
    migrationProcess = undefined
  }
  const migrate = name => {
    migrationProcess = `${project}-migration-${attempt}-${name}`
    state.migrationProcess = migrationProcess
    state.migrationChanges = Object.fromEntries(['auth', 'chat'].map(database => [database, { known: false, added: [], changed: null }]))
    phase(`migration-${name}`)
    try {
      const model = structuredClone(activeModel)
      model.services.viewer.image = JSON.parse(docker('image', 'inspect', model.services.viewer.image))[0].Id
      model.services.viewer.pull_policy = 'never'
      compose(model, 'run', '-d', '--no-deps', '--name', migrationProcess, '--entrypoint', 'node', 'viewer',
        name === 'auth' ? 'scripts/migrate.mjs' : 'scripts/migrate-chat.mjs')
      const exitCode = docker('wait', migrationProcess)
      state.migrationExitCodes = { ...state.migrationExitCodes, [name]: exitCode }
      if (exitCode !== '0') throw new Error('Database migration failed')
    } finally { stopMigration() }
  }
  const stop = (preserve = []) => {
    let failed = false
    for (const c of containers(project)) {
      // SIGKILL stops paused writers without a window for more accepted writes.
      try {
        if (preserve.includes(service(c))) { if (c.State.Paused) docker('unpause', c.Id) }
        else if (c.State.Running) docker('kill', c.Id)
      } catch { failed = true }
    }
    if (failed) throw new Error('Required services could not be stopped')
  }
  function verifyRestoredRuntime(expected, privatePorts = false) {
    const restored = Object.fromEntries(containers(project).map(c => [service(c), runtimeIdentity(c)]))
    if (!same(Object.keys(restored).sort(), Object.keys(expected).sort())) throw new Error('Previous service set was not restored')
    for (const [name, value] of Object.entries(restored)) {
      const actual = recoveryIdentity(value, privatePorts), baseline = recoveryIdentity(expected[name], privatePorts)
      if (!same(actual, baseline)) {
        const fields = ['config', 'host'].flatMap(group => Object.keys(actual[group]).filter(key => !same(actual[group][key], baseline[group][key])).map(key => `${group}.${key}`))
        if (!same(actual.mounts, baseline.mounts)) fields.push('mounts')
        if (actual.image !== baseline.image) fields.push('image')
        throw new Error(`Managed previous runtime differs for ${name}: ${fields.join(', ')}`)
      }
    }
    return restored
  }
  async function accept(model, version, chatEnabled, expectedRuntime) {
    const privateModel = structuredClone(model)
    for (const config of Object.values(privateModel.services)) if (config.ports) config.ports = []
    const identities = Object.fromEntries(Object.entries(model.services).map(([name, config]) => [name, JSON.parse(docker('image', 'inspect', config.image))[0].Id]))
    const wanted = Object.keys(model.services).filter(name => name !== 'caddy' && (chatEnabled || name !== 'centrifugo'))
    compose(privateModel, 'up', '-d', '--no-build', '--pull', 'never', '--no-deps', ...wanted)
    if (!chatEnabled) compose(privateModel, 'create', '--no-build', '--pull', 'never', 'centrifugo')
    let healthy = false
    for (let n = 0; n < 30; n++) {
      try {
        const current = containers(project)
        for (const name of wanted) {
          const c = current.find(c => service(c) === name)
          const image = identities[name]
          if (!c?.State.Running || c.State.Paused || c.State.Restarting || c.Image !== image || c.State.Health && c.State.Health.Status !== 'healthy') throw new Error('Required service is unhealthy')
        }
        const live = current.find(c => service(c) === 'viewer')
        if (env(live, 'CHAT_ENABLED') !== String(chatEnabled)) throw new Error('Chat flag changed')
        if (!chatEnabled && current.find(c => service(c) === 'centrifugo')?.State.Running) throw new Error('Disabled broker started')
        const health = applicationHealth(docker, live.Id)
        if (!applicationAccepted(health, version, chatEnabled)) throw new Error('Application acceptance failed')
        checkHistory(chatEnabled)
        healthy = true
        break
      } catch { await delay(1000) }
    }
    if (!healthy) throw new Error('Application or required service acceptance failed')
    // Validate the actual proxy with its public ports closed until acceptance.
    compose(privateModel, 'up', '-d', '--no-build', '--pull', 'never', '--no-deps', 'caddy')
    const proxy = containers(project).find(c => service(c) === 'caddy')
    caddyConfiguration(proxy)
    const live = containers(project).find(c => service(c) === 'viewer')
    docker('exec', live.Id, 'node', '--input-type=module', '-e', readFileSync(join(scripts, 'deployment-proxy.mjs'), 'utf8') + '\nawait verifyPrivateProxy(process.argv[1]).catch(()=>process.exit(1))', model.services.caddy.environment.PUBLIC_HOSTNAME)
    for (const current of containers(project)) {
      if (current.Image !== identities[service(current)]) throw new Error('Required service image differs')
    }
    checkHistory(chatEnabled)
    if (ownershipRecorded) host('check-ownership', { path: `/stage/deployments/${attempt}-ownership.json` })
    if (expectedRuntime) verifyRestoredRuntime(expectedRuntime, true)
    // All application, database, service, and proxy checks precede public access.
    phase('accepted')
    const exposed = wanted.filter(name => model.services[name].ports?.length)
    if (exposed.length) compose(model, 'up', '-d', '--no-build', '--pull', 'never', '--no-deps', '--wait', '--wait-timeout', '30', ...exposed)
    if (exposed.includes('mediamtx')) {
      phase('public-service-health')
      const startedAt = Date.parse(containers(project).find(c => service(c) === 'mediamtx').State.StartedAt)
      let fresh = false
      for (let n = 0; n < 60; n++) {
        const health = containers(project).find(c => service(c) === 'mediamtx-health')?.State.Health
        if (health?.Status === 'healthy' && health.Log?.some(check => check.ExitCode === 0 && Date.parse(check.Start) >= startedAt)) { fresh = true; break }
        await delay(500)
      }
      if (!fresh) throw new Error('Required MediaMTX checks did not pass after public port activation')
    }
    compose(privateModel, 'stop', '-t', '2', 'caddy')
    phase('opening-proxy')
    if (backupReceipt) docker('stop', '-t', '2', `maintenance-proxy-${backupReceipt.attempt}`)
    compose(model, 'up', '-d', '--no-build', '--pull', 'never', '--no-deps', 'caddy')
    const opened = containers(project).find(c => service(c) === 'caddy')
    if (!opened?.State.Running || opened.Image !== proxy.Image) throw new Error('Public proxy failed to start')
    caddyConfiguration(opened)
    const publicUrl = url || `https://${env(initial.find(c => service(c) === 'caddy'), 'PUBLIC_HOSTNAME')}/`
    let publicHealthy = false
    for (let n = 0; n < 20; n++) {
      try {
        await verifyProxy(async (path, headers) => {
          const response = await fetch(new URL(path, publicUrl), { headers, redirect: 'manual', signal: AbortSignal.timeout(2000) })
          return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() }
        })
        for (const c of containers(project)) {
          const running = chatEnabled || service(c) !== 'centrifugo'
          if (c.Image !== identities[service(c)] || c.State.Running !== running || c.State.Paused || c.State.Restarting ||
              running && c.State.Health && c.State.Health.Status !== 'healthy') throw new Error('Required public service failed')
        }
        publicHealthy = true
        break
      } catch { await delay(300) }
    }
    if (!publicHealthy) throw new Error('Public proxy or service verification failed')

  }
  try {
    if (recovery) {
      // Restart the private tool only. Managed application containers never restart here.
      if (!docker('ps', '-aq', '--filter', `name=^/${tool}$`)) {
        state = JSON.parse(docker('run', '--rm', '--user', '0', '--network', 'none', '-v', `${volume}:/stage:ro`, '--entrypoint', 'cat', viewer.Image, '/stage/deployment-status.json'))
        attempt = state.attempt
        createTool()
      }
      else docker('start', tool)
      await claim()
      const bootstrap = JSON.parse(JSON.parse(docker('inspect', tool))[0].Config.Labels['org.frankerzspam.deployment-state'])
      let saved = host('exists', { path: '/stage/deployment-status.json' }).exists ? read('/stage/deployment-status.json') : bootstrap
      if (saved.attempt !== bootstrap.attempt && (saved.phase === 'complete' || saved.result === 'rejected')) saved = bootstrap
      state = saved; attempt = state.attempt
      if (state.result === 'rejected') { preserveState = true; retained = false; throw new Error('Managed preflight was rejected. Repair it and run a new deployment.') }
      if (state.phase === 'adopting' && !host('exists', { path: '/stage/current.json' }).exists) {
        if (recovery !== 'previous' || restore !== 'none') { preserveState = true; throw new Error('Managed adoption recovery requires previous release and no restore') }
        const current = await adoptInstallation({ docker, tool, project, target, info, initial, save, host, lock: state.chatLock })
        save(`/stage/deployments/${attempt}-previous.json`, current)
        state.result = 'active'; state.version = current.version; state.chatEnabled = current.chatEnabled
        state.completion = { source: current.source }; state.adoption = current.adoption
        state.nextAction = 'Adoption completed. Deploy a verified tag.'
        phase('complete'); retained = false
        return state
      }
      previous = read(state.previousRelease ? `/stage/deployments/${attempt}-previous.json` : '/stage/current.json')
      if (!state.previousRelease) save(`/stage/deployments/${attempt}-previous.json`, previous)
      state.previousRelease ??= { version: previous.version, source: previous.source }
      state.chatEnabled ??= previous.chatEnabled
      backupReceipt = state.backup
      migrationBaseline = state.migrations ?? previous.migrations
      staged = { attempt: state.stagedAttempt }
      activeModel = state.candidateRelease ? read(`${state.candidateRelease.source}/resolved-compose.json`) : undefined
      owned = true; retained = true
      cancelChatTrial(target)
      ownershipRecorded = host('exists', { path: `/stage/deployments/${attempt}-ownership.json` }).exists
      const marker = `${dirname(env(viewer, 'AUTH_DB_PATH'))}/.maintenance-backup.json`
      if (state.completion && !host('exists', { path: marker }).exists) {
        // Completed attempts have no maintenance owner. A rejected repeat must
        // leave their accepted services and durable result untouched.
        preserveState = true; retained = false
        if (restore !== 'none') throw new Error('Managed completion recovery cannot replace databases')
        const selected = recovery === 'previous' ? previous : { source: state.candidateRelease?.source }
        const current = read('/stage/current.json')
        if (current.source !== selected.source || current.tree !== host('tree', { path: current.source }).digest ||
            !same(current.model, chatModel(read(`${current.source}/resolved-compose.json`), current.chatEnabled))) throw new Error('Managed completed release differs')
        if (backupReceipt && !host('exists', { path: `${dirname(env(viewer, 'AUTH_DB_PATH'))}/.maintenance-completed-${backupReceipt.attempt}.json` }).exists) throw new Error('Managed completion evidence is missing')
        resumeChatLock()
        acceptanceHistory = current.migrations
        checkHistory()
        verifyRestoredRuntime(current.runtime)
        const running = containers(project).every(c => c.State.Running === (current.chatEnabled || service(c) !== 'centrifugo') &&
          !c.State.Paused && !c.State.Restarting && (!c.State.Running || !c.State.Health || c.State.Health.Status === 'healthy'))
        if (!running) {
          retained = true
          const completedBackup = backupReceipt
          backupReceipt = undefined
          try { await accept(current.model, current.version, current.chatEnabled, adoptedRecoveryRuntime(current)) }
          finally { backupReceipt = completedBackup }
          current.runtime = verifyRestoredRuntime(adoptedRecoveryRuntime(current))
          if (current.adoption) { current.adoption.legacyRuntime = false; current.adoption.pending = false }
          save('/stage/current.json', current)
        } else {
          const live = containers(project).find(c => service(c) === 'viewer')
          const health = applicationHealth(docker, live.Id)
          if (!applicationAccepted(health, current.version, current.chatEnabled)) throw new Error('Application acceptance failed')
          await verifyProxy(async (path, headers) => {
            const response = await fetch(new URL(path, url || `https://${env(initial.find(c => service(c) === 'caddy'), 'PUBLIC_HOSTNAME')}/`), { headers, redirect: 'manual', signal: AbortSignal.timeout(2000) })
            return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() }
          })
        }
        preserveState = false
        state.result = 'recovered'; state.version = current.version
        state.nextAction = 'Completed release verified. No migrations or database replacement repeated.'
        if (state.chatLock) host('chat-unlock', state.chatLock)
        phase('complete'); retained = false
        if (!state.chatLock) state.retention = await clean(true)
        return state
      }
      if (!backupReceipt) {
        if (recovery !== 'previous' || restore !== 'none') { preserveState = true; throw new Error('Managed preparation recovery requires previous release and no restore') }
        resumeChatLock()
        if (previous.tree !== host('tree', { path: previous.source }).digest) throw new Error('Managed previous files changed')
        checkHistory()
        const stageOwner = docker('ps', '-aq', '--filter', `name=^/${project}-stage-operation$`)
        if (stageOwner) {
          const container = JSON.parse(docker('inspect', stageOwner))[0]
          if (container.Config.Labels['org.frankerzspam.deployment-attempt'] !== attempt) throw new Error('Managed staging owner differs')
          docker('rm', '-f', stageOwner)
        }
        state.recovery = { release: recovery, databases: restore, possibleDataLoss: false }
        phase('recovery-activation')
        await accept(previous.model, previous.version, previous.chatEnabled, adoptedRecoveryRuntime(previous))
        previous.runtime = verifyRestoredRuntime(adoptedRecoveryRuntime(previous))
        if (previous.adoption) { previous.adoption.legacyRuntime = false; previous.adoption.pending = false }
        save('/stage/current.json', previous)
        if (state.chatLock) host('chat-unlock', state.chatLock)
        state.result = 'recovered'; state.version = previous.version
        state.nextAction = 'Previous release passed acceptance. Preparation was cancelled.'
        state.completion = { source: previous.source }
        phase('complete'); retained = false
        if (!state.chatLock) state.retention = await clean(true)
        return state
      }
      migrationProcess = state.migrationProcess
      const completing = Boolean(state.completion)
      stopMigration()
      stop()
      docker('start', `maintenance-tool-${backupReceipt.attempt}`)
      docker('start', `maintenance-proxy-${backupReceipt.attempt}`)
      if (!completing) {
        const backupState = maintenance('state')
        if (backupState.attempt !== backupReceipt.attempt || backupState.deploymentAttempt !== attempt) throw new Error('Managed backup owner differs')
        if (backupState.hostManifest) {
          const verified = await acknowledgeBackup(`maintenance-tool-${backupReceipt.attempt}`, join(directory, 'backups'), attempt)
          backupReceipt = state.backup = { ...backupReceipt, backupId: verified.backupId, hostManifest: verified.hostManifest,
            workstationManifest: verified.workstationManifest, acknowledged: true }
        } else {
          if (restore !== 'none' || recovery !== 'previous') throw new Error('Managed recovery has no completed backup')
          checkHistory()
          maintenance('phase', { phase: 'held' })
        }
      } else if (restore !== 'none') throw new Error('Managed completion recovery cannot replace databases')
      observe()

      state.recovery = { release: recovery, databases: restore, possibleDataLoss: restore !== 'none' }
      phase('recovery-validation')
      const selected = recovery === 'previous' ? previous : {
        source: state.candidateRelease.source, version: state.candidateRelease.version,
        tree: state.candidateRelease.tree, model: read(`${state.candidateRelease.source}/resolved-compose.json`),
        chatEnabled: state.chatEnabled,
      }
      if (completing && read('/stage/current.json').source !== selected.source) throw new Error('Managed completion requires the accepted release')
      if (!selected.tree || host('tree', { path: selected.source }).digest !== selected.tree || !same(selected.model, read(`${selected.source}/resolved-compose.json`))) throw new Error('Managed recovery files changed')
      if (restore !== 'none' && confirm !== 'discard-later-data') throw new Error('Database replacement can discard later data; use --confirm discard-later-data')
      const helper = `maintenance-tool-${backupReceipt.attempt}`
      for (const file of ['deployment-restore.mjs', 'backup-operation.mjs', 'database-backups.mjs', 'chat-retention.mjs', 'chat-restore-references.mjs']) docker('cp', join(scripts, file), `${helper}:/app/scripts/${file}`)
      phase('recovery-databases')
      if (!completing) docker('exec', helper, 'node', '/app/scripts/deployment-restore.mjs', JSON.stringify({
        selected: restore === 'none' ? [] : restore === 'both' ? ['auth', 'chat'] : [restore],
        paths: { auth: env(viewer, 'AUTH_DB_PATH'), chat: env(viewer, 'CHAT_DB_PATH') },
        expected: host('migration-names', { path: selected.source }), manifest: backupReceipt.hostManifest, maintenanceAttempt: backupReceipt.attempt,
      }))
      acceptanceHistory = databaseState(false, { expected: selected.source })
      if (!acceptanceHistory.auth || !acceptanceHistory.chat) throw new Error('Database recovery state is uncertain')
      phase('recovery-activation')
      await accept(selected.model, selected.version, selected.chatEnabled, recovery === 'previous' ? adoptedRecoveryRuntime(selected) : undefined)
      if (recovery === 'previous') verifyRestoredRuntime(adoptedRecoveryRuntime(selected))
      if (selected.adoption) { selected.adoption.legacyRuntime = false; selected.adoption.pending = false }
      save('/stage/current.json', { ...selected, format: 1, result: 'active', migrations: acceptanceHistory,
        runtime: Object.fromEntries(containers(project).map(c => [service(c), runtimeIdentity(c)])) })
      finish(selected.source)
      state.result = 'recovered'; state.version = selected.version
      state.nextAction = 'Recovery passed acceptance.'
      phase('complete')
      retained = false
      state.retention = await clean(true)
      return state
    }
    createTool()
    await claim()
    if (host('exists', { path: '/stage/deployment-status.json' }).exists) {
      const saved = read('/stage/deployment-status.json')
      if (saved.phase !== 'complete' && saved.result !== 'rejected') {
        preserveState = true; retained = true
        throw Object.assign(new Error('Managed attempt is unresolved'), { report: saved })
      }
    }
    if (adopt) {
      if (host('exists', { path: '/stage/current.json' }).exists) { preserveState = true; throw new Error('Managed baseline already exists; inspect status and deploy a selected tag') }
      state.chatLock = { attempt, directory: env(viewer, 'AUTH_BACKUP_DIR') || '/data/backups', authPath: env(viewer, 'AUTH_DB_PATH') }
      phase('adopting')
      const current = await adoptInstallation({ docker, tool, project, target, info, initial, save, host, lock: state.chatLock })
      save(`/stage/deployments/${attempt}-previous.json`, current)
      state.result = 'active'; state.version = current.version; state.chatEnabled = current.chatEnabled
      state.completion = { source: current.source }; state.adoption = current.adoption
      state.nextAction = 'Adopted legacy baseline. Deploy a verified tag; this baseline has no GitHub verification claim.'
      phase('complete')
      return state
    }
    if (cleanup) {
      preserveState = true
      const completed = read('/stage/deployment-status.json')
      if (completed.phase !== 'complete' || !['active', 'recovered'].includes(completed.result)) throw new Error('Managed cleanup requires a successful deployment or recovery')
      const current = read('/stage/current.json')
      if (!applicationAccepted(applicationHealth(docker, viewer.Id), current.version, current.chatEnabled)) throw new Error('Application acceptance failed')
      attempt = completed.attempt
      const retention = await clean(true)
      if (retention.status !== 'complete') process.exitCode = 1
      return { result: 'cleanup', retention }
    }
    phase('baseline')
    previous = read('/stage/current.json')
    if (chatAction) {
      state.chatEnabled = previous.chatEnabled
      state.previousRelease = { version: previous.version, source: previous.source }
      save(`/stage/deployments/${attempt}-previous.json`, previous)
      state.migrations = previous.migrations
      state.chatLock = { attempt, directory: env(viewer, 'AUTH_BACKUP_DIR') || '/app/.data/backups', authPath: env(viewer, 'AUTH_DB_PATH') }
      phase('chat-lock')
      host('chat-lock', state.chatLock)
      chatLocked = true
      phase('chat-validation')
    }
    if (previous.format !== 1 || previous.result !== 'active' || !previous.source?.startsWith('/stage/') || previous.source.includes('..') ||
        previous.tree !== host('tree', { path: previous.source }).digest || !same(previous.model, chatModel(read(`${previous.source}/resolved-compose.json`), previous.chatEnabled))) throw new Error('Verified managed baseline is missing or changed')
    if (initial.length !== Object.keys(previous.runtime).length || initial.some(c => !same(runtimeIdentity(c), previous.runtime[service(c)]))) throw new Error('Managed runtime differs from its verified baseline')
    if (previous.adoption?.pending) throw new Error('Managed adoption is incomplete; recover before activation')
    if (previous.adoption?.legacyRuntime) {
      verifyAdoptedFiles(initial, previous)
      host('check-ownership', { path: `${previous.source}/volume-ownership.json` })
    }
    if (!same(previous.model.services.viewer.entrypoint, ['node']) || !same(previous.model.services.viewer.command, ['server.js'])) throw new Error('Managed baseline must suppress startup migrations')
    if (Object.values(previous.model.services).some(config => config.restart !== 'no')) throw new Error('Managed baseline must disable restart retries')
    const chat = env(viewer, 'CHAT_ENABLED')
    if (!['true', 'false'].includes(chat) || previous.chatEnabled !== (chat === 'true')) throw new Error('Managed Chat state is uncertain')
    state.chatEnabled = previous.chatEnabled
    state.previousRelease = { version: previous.version, source: previous.source }
    save(`/stage/deployments/${attempt}-previous.json`, previous)
    state.migrations = previous.migrations
    if (chatAction) {
      phase('chat-changing')
      const report = await changeChat({ cancelTrial: () => cancelChatTrial(target), action: chatAction, current: previous, docker, containers: () => containers(project), compose, read, save, host, tool, info, databaseState })
      state.chatEnabled = report.chatEnabled
      state.capacity = report.capacity
      state.completion = { source: previous.source }
      state.result = report.failed ? 'failed-disabled' : 'active'
      state.reason = report.reason
      state.nextAction = report.failed ? 'Repair the Chat prerequisite and retry enable.' : 'Chat state saved.'
      phase('complete')
      host('chat-unlock', state.chatLock)
      chatLocked = false
      if (report.failed) process.exitCode = 1
      return { ...state, chat: report.chat }
    }
    cancelChatTrial(target)
    phase('staging')
    const record = await selectedRelease(tag)
    staged = await stageOrStatus({ action: 'prepare', target, tag, record, project, directory, deploymentAttempt: attempt, onState: value => { state.staging = { attempt: value.attempt, source: `/stage/${value.attempt}/source`, images: value.requiredImages ?? Object.values(value.images) }; phase('staging') } })
    state.stagedAttempt = staged.attempt
    state.candidateRelease = { tag, version: record.version, source: `/stage/${staged.attempt}/source` }
    activeModel = read(`/stage/${staged.attempt}/source/resolved-compose.json`)
    activeModel.services.viewer.entrypoint = ['node']
    activeModel.services.viewer.command = ['server.js']
    for (const config of Object.values(activeModel.services)) config.restart = 'no'
    if (activeModel.services.viewer.environment.CHAT_ENABLED !== String(previous.chatEnabled)) throw new Error('Candidate Chat flag changed')
    for (const [name, config] of Object.entries(activeModel.services)) {
      if (!same(portIdentity(config.ports), portIdentity(previous.model.services[name].ports))) throw new Error('Candidate public service ports changed')
    }
    if (activeModel.services.caddy.environment.AUTH_BACKUP_KEY !== env(initial.find(c => service(c) === 'caddy'), 'AUTH_BACKUP_KEY')) throw new Error('Credential rotation requires a separate operation')
    // External credential rotation is not a recoverable deployment operation.
    for (const key of ['BETTER_AUTH_SECRET', 'INTERNAL_AUTH_SECRET', 'MEDIAMTX_AUTH_SECRET', 'CENTRIFUGO_API_KEY', 'CENTRIFUGO_TOKEN_HMAC_SECRET', 'CHAT_TAG_HMAC_SECRET']) {
      if (String(activeModel.services.viewer.environment[key]) !== env(viewer, key)) throw new Error('Credential rotation requires a separate operation')
    }
    const unchanged = []
    for (const [name, config] of Object.entries(activeModel.services)) {
      const old = previous.model.services[name]
      if (JSON.parse(docker('image', 'inspect', config.image))[0].Id === JSON.parse(docker('image', 'inspect', old.image))[0].Id) config.image = old.image
      if (!config.ports?.length && !['viewer', 'caddy', 'centrifugo', 'discord-notifier'].includes(name) && same(config, old)) unchanged.push(name)
    }
    save(`/stage/${staged.attempt}/source/resolved-compose.json`, activeModel)
    phase('migration-preflight')
    migrationBaseline = databaseState(false, { previous: previous.source, candidate: `/stage/${staged.attempt}/source` })
    if (!same(migrationBaseline, previous.migrations)) throw new Error('Database migration history differs from the managed baseline')
    state.migrations = migrationBaseline
    // Keep the resolved model, secrets, scripts, images, and volume identities in private host storage.
    save(`/stage/deployments/${attempt}-previous.json`, previous)
    state.candidateRelease.tree = host('tree', { path: state.candidateRelease.source }).digest
    phase('maintenance-backup')
    backupReceipt = await maintenanceBackup({ project, directory: join(directory, 'backups'), url, hold: true, deploymentAttempt: attempt, onState: backup => { state.backup = backup; phase('maintenance-backup') } })
    state.backup = backupReceipt
    phase('stopping-writers')
    stop(unchanged)
    checkHistory()
    // The backup receipt is produced only after encrypted workstation verification and acknowledgement.
    const held = maintenance('state')
    if (held.phase !== 'held' || !backupReceipt.backupId || !backupReceipt.workstationManifest ||
        !same(held.acknowledgement, { deploymentAttempt: attempt, attempt: backupReceipt.attempt, backupId: backupReceipt.backupId })) throw new Error('Workstation acknowledgement is missing')
    requireSpace(join(directory, 'backups'), 64 * 1024 ** 2, 1000)
    phase('activation-preflight')
    const budget = { databases: { auth: env(viewer, 'AUTH_DB_PATH'), chat: env(viewer, 'CHAT_DB_PATH') },
      stageBytes: 64 * 1024 ** 2, files: 1000, imageBytes: 0,
      minimumFreeBytes: Number(activeModel.services.viewer.environment.CHAT_MINIMUM_FREE_BYTES),
      databaseLimitBytes: Number(activeModel.services.viewer.environment.CHAT_DATABASE_LIMIT_BYTES) }
    const measured = JSON.parse(docker('exec', '-w', '/app', tool, 'node', '--input-type=module', '-e', readFileSync(join(scripts, 'stage-databases.mjs'), 'utf8'), JSON.stringify(budget)))
    docker('exec', tool, 'node', '/app/stage-host.mjs', 'check', JSON.stringify({ ...budget, ...measured }))
    phase('volume-ownership')
    const volumePaths = [...new Set(initial.flatMap(c => c.Mounts).filter(m => m.Type === 'volume').map(m => {
      if (!m.Source.startsWith(`${info.DockerRootDir}/`)) throw new Error('Managed volume location is unsupported')
      return '/docker-storage' + m.Source.slice(info.DockerRootDir.length)
    }))]
    host('ownership', { paths: volumePaths, destination: `/stage/deployments/${attempt}-ownership.json` })
    ownershipRecorded = true
    state.candidateRelease.tree = host('tree', { path: state.candidateRelease.source }).digest
    migrate('auth')
    migrate('chat')
    acceptanceHistory = observe()
    if (Object.values(state.migrationChanges).some(change => !change.known || change.changed) ||
        !same(databaseState(false, { expected: `/stage/${staged.attempt}/source` }), acceptanceHistory)) throw new Error('Database migration result is uncertain')
    phase('activation')
    await accept(activeModel, record.version, previous.chatEnabled)
    state.result = 'active'; state.version = record.version
    const current = { format: 1, result: 'active', version: record.version, source: `/stage/${staged.attempt}/source`, model: activeModel,
      tree: host('tree', { path: `/stage/${staged.attempt}/source` }).digest, migrations: acceptanceHistory, chatEnabled: previous.chatEnabled,
      runtime: Object.fromEntries(containers(project).map(c => [service(c), runtimeIdentity(c)])) }
    save('/stage/current.json', current)
    finish(current.source)
    phase('complete')
    state.retention = await clean(true)
    return state
  } catch (error) {
    if (preserveState) throw error
    if (owned && (adopt || state.phase === 'adopting')) {
      retained = true
      state.result = 'adoption-retry-required'
      state.reason = 'Adoption could not complete its checks or job update'
      state.nextAction = 'Repair the adoption prerequisite, then recover with previous release and no database restore. Existing services were not stopped.'
      try { phase('adopting') } catch { /* Keep the owner and original adoption intent. */ }
      throw Object.assign(new Error('Adoption requires retry'), { report: state })
    }
    if (!recovery) state.failedPhase = state.phase
    else state.recoveryFailedPhase = state.phase
    state.reason = /^(Verified managed|Managed |Candidate |Credential |Database |Application |Required |Public |Docker )/.test(error.message) ? error.message : 'Deployment check failed'
    state.result = 'rejected'
    state.nextAction = 'Repair the failed preflight and run a new deployment.'
    if (chatAction && chatLocked) {
      retained = true
      // Do not recreate services from files or a runtime that failed verification.
      // Stop both token issuance and cached connections, retaining the recorded flag.
      let live = initial
      try { live = containers(project) } catch { /* Fall back to the last known identities. */ }
      for (const name of ['centrifugo', 'viewer']) {
        try { docker('stop', '-t', '2', live.find(c => service(c) === name).Id) } catch { /* Recovery must verify both stopped services. */ }
      }
      state.chat = { status: 'unavailable' }
      state.result = 'chat-recovery-required'
      state.nextAction = 'Chat validation or cleanup failed. Broker and viewer shutdown requested. Repair drift, then recover the previous release with no database restore.'
    } else if (backupReceipt && !recovery) {
      retained = true
      state.result = 'maintenance-required'
      state.nextAction = 'Keep maintenance active. Inspect the private attempt record and both database histories. Use explicit recovery; do not restore databases automatically.'
      try {
        phase('checking-rollback')
        stopMigration()
        stop()
        docker('start', `maintenance-proxy-${backupReceipt.attempt}`)
        const after = observe()
        if (!same(after, migrationBaseline)) throw new Error('Database migration history changed or is uncertain')
        acceptanceHistory = migrationBaseline
        checkHistory()
        if (ownershipRecorded) host('check-ownership', { path: `/stage/deployments/${attempt}-ownership.json` })
        if (previous.tree !== host('tree', { path: previous.source }).digest) throw new Error('Previous files changed')
        phase('rollback')
        await accept(previous.model, previous.version, previous.chatEnabled, adoptedRecoveryRuntime(previous))
        previous.runtime = verifyRestoredRuntime(adoptedRecoveryRuntime(previous))
        if (previous.adoption) { previous.adoption.legacyRuntime = false; previous.adoption.pending = false }
        save('/stage/current.json', previous)
        finish(previous.source)
        state.result = 'failed-rolled-back'
        state.nextAction = 'Previous release restored. Repair the selected release before another deployment.'
        retained = false
      } catch (recoveryError) {
        state.recoveryFailedPhase = state.phase
        state.recoveryReason = /^(Previous |Public |Required |Database |Docker )/.test(recoveryError.message) ? recoveryError.message : 'Recovery check failed'
        try { stop(); docker('start', `maintenance-proxy-${backupReceipt.attempt}`) } catch { /* Retain all recovery evidence and the owner. */ }
      }
    } else if (recovery && owned) {
      retained = true
      state.result = 'maintenance-required'
      state.nextAction = 'Recovery failed. Keep maintenance active and inspect the database and release choices.'
      try { stop(); docker('start', `maintenance-proxy-${backupReceipt.attempt}`) } catch {}
    } else {
      // The backup command owns failures before it returns a verified receipt.
      try {
        const report = JSON.parse(error.message)
        if (report.result === 'maintenance-retained') { retained = true; state.result = 'maintenance-required'; state.nextAction = report.nextAction }
      } catch { /* Controlled preflight failure. */ }
    }
    if (owned) { try { phase(state.result === 'failed-rolled-back' ? 'complete' : state.result) } catch { retained = true } }
    throw Object.assign(new Error('Deployment failed'), { report: state })
  } finally {
    rmSync(work, { recursive: true, force: true })
    if (owned && !retained) {
      if (backupReceipt) for (const id of [`maintenance-tool-${backupReceipt.attempt}`, `maintenance-proxy-${backupReceipt.attempt}`]) { try { docker('rm', '-f', id) } catch {} }
      try { docker('rm', '-f', tool) } catch { /* A remaining owner requires inspection. */ }
    }
    setDeploymentOwner(undefined)
    if (connectionFd !== undefined) closeSync(connectionFd)
  }
}
async function main() {
  const [action, target, ...args] = process.argv.slice(2)
  const chatAction = action?.startsWith('chat-') ? action.slice(5) : undefined
  const tag = action === 'managed' ? args.shift() : undefined
  const options = { target, tag, chatAction, cleanup: action === 'cleanup', adopt: action === 'adopt', project: 'mediamtx-viewer', directory: join(homedir(), '.local/share/mediamtx-deployments') }
  while (args.length) {
    const key = args.shift(), value = args.shift()
    if (!['--project', '--directory', '--url', '--release', '--restore', '--confirm'].includes(key) || !value) throw new Error('Invalid deployment option')
    options[key.slice(2)] = key === '--directory' ? resolve(value) : value
  }
  if (!['managed', 'adopt', 'recover', 'cleanup', 'chat-enable', 'chat-disable', 'chat-health'].includes(action) || !/^[a-zA-Z0-9_@.:-]+$/.test(target ?? '') || target.startsWith('-') || action === 'managed' && !/^v\d+\.\d+\.\d+$/.test(tag ?? '') || !/^[a-z0-9][a-z0-9_-]*$/.test(options.project)) throw new Error('Usage: deploy.sh managed TARGET TAG [--project NAME] [--directory PATH] [--url URL]')
  if (action === 'recover') {
    if (!['previous', 'candidate'].includes(options.release) || !['none', 'auth', 'chat', 'both'].includes(options.restore)) throw new Error('Recovery requires --release previous|candidate --restore none|auth|chat|both. Replacement can discard later data and requires --confirm discard-later-data.')
    if (options.restore !== 'none' && options.confirm !== 'discard-later-data') throw new Error('Database replacement can discard later data; use --confirm discard-later-data')
    options.recovery = options.release
  }
  return deploy(options)
}
try { console.log(JSON.stringify(await main())) }
catch (error) { console.error(JSON.stringify(error.report ?? { result: 'rejected', phase: 'preflight', nextAction: error.message })); process.exitCode = 1 }
