import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { selectedRelease } from './stage-release-source.mjs'
import { runtimeIdentity } from './deployment-state.mjs'

export function chatModel(model, enabled) {
  const copy = structuredClone(model)
  copy.services.viewer.environment.CHAT_ENABLED = String(enabled)
  return copy
}
const service = container => container.Config.Labels?.['com.docker.compose.service']

export function applicationHealth(docker, viewerId) {
  return JSON.parse(docker('exec', viewerId, 'node', '-e',
    "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok)process.exit(1);console.log(JSON.stringify(await r.json()))}).catch(()=>process.exit(1))"))
}
export function applicationAccepted(health, version, chatEnabled) {
  return health.status === 'ok' && health.version === version && health.chat?.status === (chatEnabled ? 'healthy' : 'disabled')
}

export function chatHealth(docker, containers, current) {
  let health
  try {
    const viewer = containers.find(c => service(c) === 'viewer')
    health = applicationHealth(docker, viewer.Id)
  } catch { health = { status: 'unavailable', chat: { status: 'unavailable' } } }
  const broker = containers.find(c => service(c) === 'centrifugo')
  const brokerHealthy = broker?.State.Running && !broker.State.Paused && !broker.State.Restarting && broker.State.Health?.Status === 'healthy'
  const consistent = containers.find(c => service(c) === 'viewer')?.Config.Env.includes(`CHAT_ENABLED=${current.chatEnabled}`)
  const expected = current.chatEnabled ? 'healthy' : 'disabled'
  const accepted = consistent && applicationAccepted(health, current.version, current.chatEnabled) &&
    (current.chatEnabled ? brokerHealthy : broker?.State.Running === false)
  return { chatEnabled: current.chatEnabled, chat: { ...health.chat, status: accepted ? expected :
    ['degraded', 'unavailable'].includes(health.chat?.status) ? health.chat.status : 'degraded' }, capacity: 'unverified', accepted }
}

// Runs while the deployment owner and backup lock are held.
export async function changeChat({ cancelTrial, action, current, docker, containers, compose, read, save, tool, info, databaseState }) {
  let failure
  const apply = async enabled => {
    const model = chatModel(current.model, enabled)
    if (enabled) compose(model, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', 'centrifugo')
    else compose(model, 'stop', 'centrifugo')
    compose(model, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', 'viewer')
    let report
    for (let n = 0; n < 20; n++) {
      report = chatHealth(docker, containers(), { ...current, chatEnabled: enabled })
      if (report.accepted) break
      await delay(500)
    }
    if (!report.accepted) throw new Error('Application Chat acceptance failed')
    if (enabled) {
      const history = databaseState(true)
      if (!history.auth || !history.chat) throw new Error('Database integrity or Chat outbox check failed')
    }
    current.model = model
    current.chatEnabled = enabled
    current.runtime = Object.fromEntries(containers().map(c => [service(c), runtimeIdentity(c)]))
    save('/stage/current.json', current)
    return report
  }
  try {
    cancelTrial()
    if (action === 'enable') {
      const stored = read(`${current.source}/release.json`)
      const verified = await selectedRelease(stored.tag)
      for (const key of ['tag', 'version', 'commit', 'tagObject', 'sourceFingerprint']) {
        if (verified[key] !== stored[key]) throw new Error('Managed release identity changed')
      }
      if (current.version !== verified.version) throw new Error('Managed release version differs')
      const live = containers()
      for (const name of ['viewer', 'thumbnailer']) {
        if (verified.images[name] !== stored.images[name]) throw new Error('Managed release image changed')
        const image = JSON.parse(docker('image', 'inspect', verified.images[name]))[0]
        if (image.Id !== live.find(c => service(c) === name)?.Image || image.Os !== 'linux' || image.Architecture !== 'arm64' ||
            !image.RepoDigests?.includes(verified.images[name]) || image.Config.Labels?.['org.frankerzspam.source'] !== verified.sourceFingerprint ||
            image.Config.Labels?.['org.opencontainers.image.revision'] !== verified.commit) throw new Error('Managed image or source verification failed')
      }
      if (!['aarch64', 'arm64'].includes(info.Architecture) || info.OSType !== 'linux') throw new Error('Managed host architecture failed')
      for (const c of live.filter(c => service(c) !== 'centrifugo')) {
        if (!c.State.Running || c.State.Paused || c.State.Restarting || c.State.Health && c.State.Health.Status !== 'healthy') throw new Error('Managed service is unhealthy')
      }
      const history = databaseState(true)
      if (!history.auth || !history.chat) throw new Error('Database integrity or Chat outbox check failed')
      const environment = current.model.services.viewer.environment
      const budget = { databases: { auth: environment.AUTH_DB_PATH, chat: environment.CHAT_DB_PATH },
        minimumFreeBytes: Number(environment.CHAT_MINIMUM_FREE_BYTES), databaseLimitBytes: Number(environment.CHAT_DATABASE_LIMIT_BYTES),
        stageBytes: 0, files: 0, imageBytes: 0 }
      const measurement = JSON.parse(docker('exec', '-w', '/app', live.find(c => service(c) === 'viewer').Id, 'node', '--input-type=module', '-e',
        readFileSync(new URL('./stage-databases.mjs', import.meta.url), 'utf8'), JSON.stringify(budget)))
      docker('exec', tool, 'node', '/app/stage-host.mjs', 'check', JSON.stringify({ ...budget, ...measurement }))
      // Match the exact broker from the verified managed model, including its pin.
      const broker = JSON.parse(docker('image', 'inspect', current.model.services.centrifugo.image))[0]
      if (broker.Id !== live.find(c => service(c) === 'centrifugo')?.Image || broker.Architecture !== 'arm64' || broker.Os !== 'linux') throw new Error('Managed broker image differs')
      return await apply(true)
    }
    return await apply(false)
  } catch (error) {
    failure = error
  }
  // Failed enable must disable both token issuance and existing broker connections.
  const report = await apply(false)
  return { ...report, failed: true, reason: /^(Managed |Database |Application |Required verification)/.test(failure.message) ? failure.message : 'Chat prerequisite failed' }
}
