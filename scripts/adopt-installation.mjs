import { runtimeIdentity } from './deployment-state.mjs'
import { createHash, timingSafeEqual } from 'node:crypto'
import { backupKey } from './database-backups.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { adoptionModel } from './adoption-model.mjs'
import { applicationHealth, applicationAccepted } from './deployment-chat.mjs'
import { caddyConfiguration } from './maintenance-backup.mjs'
import { assertDeploymentOwner, deploymentStdio } from './deployment-connection.mjs'
import { cancelChatTrial } from './cancel-chat-trial.mjs'
import { installOperationalJobs } from './install-operational-jobs.mjs'

function archiveFrom(container, path) {
  const args = ['cp', `${container}:${path}`, '-']; assertDeploymentOwner(args)
  return execFileSync('docker', args, { stdio: deploymentStdio(), timeout: 30000, maxBuffer: 64 * 1024 ** 2 })
}
const digest = value => createHash('sha256').update(value).digest('hex')
export function verifyAdoptedFiles(containers, record) {
  if (!record.adoption?.legacyRuntime) return
  if (!record.adoption.files?.length) throw new Error('Adoption file evidence is missing')
  for (const item of record.adoption.files) {
    const container = containers.find(value => value.Config.Labels['com.docker.compose.service'] === item.service)
    if (!container || digest(archiveFrom(container.Id, item.path)) !== item.digest) throw new Error('Adoption live files differ from the captured baseline')
  }
}

export async function adoptInstallation({ docker, tool, project, target, info, initial, save, host, lock }) {
  const source = '/stage/baseline/source'
  const stageRoot = JSON.parse(docker('volume', 'inspect', `${project}-deployment-staging`))[0].Mountpoint
  const baseline = adoptionModel(initial, { project, destination: `${stageRoot}/baseline/source` })
  const viewer = initial.find(container => container.Config.Labels['com.docker.compose.service'] === 'viewer')
  host('chat-lock', { ...lock, resume: true })
  try {
    const environment = baseline.model.services.viewer.environment
    if (baseline.model.services.viewer.ports?.length || !/^[a-zA-Z0-9.:-]+$/.test(baseline.model.services.caddy.environment.PUBLIC_HOSTNAME ?? '')) throw new Error('Adoption public proxy configuration is unsupported')
    if (!environment.AUTH_DB_PATH || !environment.CHAT_DB_PATH || dirname(environment.AUTH_DB_PATH) !== dirname(environment.CHAT_DB_PATH)) throw new Error('Adoption databases must share persistent storage')
    for (const key of ['BETTER_AUTH_SECRET', 'INTERNAL_AUTH_SECRET', 'MEDIAMTX_AUTH_SECRET', 'CENTRIFUGO_API_KEY', 'CENTRIFUGO_TOKEN_HMAC_SECRET', 'CHAT_TAG_HMAC_SECRET']) if (!environment[key]) throw new Error('Adoption required application secret is missing')
    const hostKey = Buffer.from(baseline.model.services.caddy.environment.AUTH_BACKUP_KEY ?? '', 'base64')
    if (hostKey.length !== 32 || !timingSafeEqual(hostKey, backupKey())) throw new Error('Adoption backup keys differ')
    if (!['arm64', 'aarch64'].includes(info.Architecture) || info.OSType !== 'linux') throw new Error('Adoption requires Linux ARM64')
    for (const container of initial) {
      const running = baseline.chatEnabled || container.Config.Labels['com.docker.compose.service'] !== 'centrifugo'
      if (container.State.Running !== running || container.State.Paused || container.State.Restarting || running && container.State.Health && container.State.Health.Status !== 'healthy') throw new Error('Adoption service health failed')
      const image = JSON.parse(docker('image', 'inspect', container.Image))[0]
      if (image.Os !== 'linux' || image.Architecture !== 'arm64') throw new Error('Adoption image architecture differs')
    }
    const health = applicationHealth(docker, viewer.Id)
    if (!health.version || !applicationAccepted(health, health.version, baseline.chatEnabled)) throw new Error('Adoption application health failed')
    for (const path of [environment.AUTH_DB_PATH, environment.CHAT_DB_PATH]) {
      if (!path?.startsWith('/') || !viewer.Mounts.some(mount => mount.Type === 'volume' && path.startsWith(`${mount.Destination}/`) && mount.RW)) throw new Error('Adoption database storage is unknown')
    }
    caddyConfiguration(initial.find(container => container.Config.Labels['com.docker.compose.service'] === 'caddy'))
    docker('exec', viewer.Id, 'node', '-e', "require('fs').accessSync('/app/server.js');require('fs').accessSync('/app/scripts/backup-auth.mjs')")
    const budget = { databases: { auth: environment.AUTH_DB_PATH, chat: environment.CHAT_DB_PATH }, stageBytes: 256 * 1024 ** 2, imageBytes: 0, files: 10000,
      minimumFreeBytes: Number(environment.CHAT_MINIMUM_FREE_BYTES), databaseLimitBytes: Number(environment.CHAT_DATABASE_LIMIT_BYTES) }
    const measured = JSON.parse(docker('exec', viewer.Id, 'node', '--input-type=module', '-e', readFileSync(new URL('./stage-databases.mjs', import.meta.url), 'utf8'), JSON.stringify(budget)))
    docker('exec', tool, 'node', '/app/stage-host.mjs', 'check', JSON.stringify({ ...budget, ...measured }))
    // Copy the mounted inode, not a possibly replaced path in the old checkout.
    // Preserve tar ownership in private host storage without exposing plaintext in argv.
    host('reset-adoption', {})
    docker('exec', tool, 'chmod', '700', '/stage', '/stage/baseline', source)
    const captured = []
    const copy = (container, path, folder) => {
      docker('exec', tool, 'mkdir', '-p', folder)
      const archive = archiveFrom(container, path)
      captured.push({ container, path, digest: digest(archive) })
      const extract = ['cp', '-a', '-', `${tool}:${folder}`]; assertDeploymentOwner(extract)
      execFileSync('docker', extract, { input: archive, stdio: ['pipe', ...deploymentStdio().slice(1)], timeout: 30000 })
    }
    for (const folder of ['migrations', 'chat-migrations']) copy(viewer.Id, `/app/${folder}`, source)
    for (const item of baseline.copies) copy(item.container, item.path, join(source, item.folder))
    save(`${source}/resolved-compose.json`, baseline.model)
    save(`${source}/legacy-runtime.json`, baseline.runtime)
    const volumePaths = [...new Set(initial.flatMap(container => container.Mounts).filter(mount => mount.Type === 'volume').map(mount => {
      if (!mount.Source.startsWith(`${info.DockerRootDir}/`)) throw new Error('Adoption volume location differs')
      return '/docker-storage' + mount.Source.slice(info.DockerRootDir.length)
    }))]
    host('ownership', { paths: volumePaths, destination: `${source}/volume-ownership.json` })
    const migrations = JSON.parse(docker('exec', tool, 'node', '/app/deployment-databases.mjs', JSON.stringify({ paths: budget.databases, expected: source })))
    if (!migrations.auth || !migrations.chat) throw new Error('Adoption migration history is uncertain')
    cancelChatTrial(target)
    await installOperationalJobs(target, project)
    // Re-read mounted files and runtime before publishing the baseline.
    for (const item of captured) if (digest(archiveFrom(item.container, item.path)) !== item.digest) throw new Error('Adoption mounted files changed during capture')
    if (!applicationAccepted(applicationHealth(docker, viewer.Id), health.version, baseline.chatEnabled)) throw new Error('Adoption final health failed')
    for (const container of initial) {
      const current = JSON.parse(docker('inspect', container.Id))[0]
      if (current.Image !== container.Image || current.State.StartedAt !== container.State.StartedAt || current.State.Running !== container.State.Running || current.State.Paused || current.State.Restarting || JSON.stringify(current.Config) !== JSON.stringify(container.Config) || JSON.stringify(current.HostConfig) !== JSON.stringify(container.HostConfig)) throw new Error('Adoption runtime changed during capture')
    }
    const record = { format: 1, result: 'active', version: health.version, source, model: baseline.model, runtime: baseline.runtime, migrations, chatEnabled: baseline.chatEnabled,
      adoption: { pending: true, legacyRuntime: true, githubVerified: false, adoptedAt: new Date().toISOString(),
        files: captured.map(item => ({ service: initial.find(container => container.Id === item.container).Config.Labels['com.docker.compose.service'], path: item.path, digest: item.digest })) }, tree: host('tree', { path: source }).digest }
    // Durable recovery target precedes the restart-policy mutation. The owner
    // and adopting phase still block deployment until this operation completes.
    save('/stage/current.json', record)
    // Disable reboot-driven startup migrations before any managed maintenance.
    // This changes no data and does not restart a container. Retrying adoption is safe.
    for (const container of initial) docker('update', '--restart=no', container.Id)
    for (const container of initial) {
      const current = JSON.parse(docker('inspect', container.Id))[0]
      if (current.HostConfig.RestartPolicy.Name !== 'no') throw new Error('Adoption restart policy update failed')
      baseline.runtime[current.Config.Labels['com.docker.compose.service']] = runtimeIdentity(current)
    }
    record.adoption.pending = false
    save('/stage/current.json', record)
    return record
  } finally { host('chat-unlock', lock) }
}
