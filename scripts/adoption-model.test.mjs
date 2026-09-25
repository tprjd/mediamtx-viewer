// @vitest-environment node
import { expect, it } from 'vitest'
import { adoptionModel, adoptionServices, adoptedRecoveryRuntime } from './adoption-model.mjs'

function observed() {
  return adoptionServices.map((name, index) => ({ Id: String(index + 1).repeat(64), Name: `/legacy-${name}-1`, Image: `sha256:${String(index + 1).repeat(64)}`,
    Config: { Hostname: String(index + 1).repeat(12), Labels: { 'com.docker.compose.project': 'legacy', 'com.docker.compose.service': name },
      Env: ['CHAT_ENABLED=true'], Entrypoint: null, Cmd: ['old-command'], User: '', WorkingDir: '' },
    HostConfig: { IpcMode: 'private', NetworkMode: 'legacy_net', ShmSize: 67108864, RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 }, LogConfig: { Type: 'json-file', Config: {} }, Binds: ['legacy_data:/data:rw'] },
    Mounts: [{ Type: 'volume', Name: 'legacy_data', Source: '/docker/volumes/legacy_data/_data', Destination: '/data', RW: true }],
    NetworkSettings: { Networks: { legacy_net: { Aliases: [name] } } },
  }))
}
it('captures actual images, secrets, volume names and Chat state without claiming release verification', () => {
  const containers = observed()
  containers[0].Config.Env.push('PRIVATE_VALUE=fixture-secret')
  const value = adoptionModel(containers, { project: 'legacy', destination: '/stage/baseline/source' })
  expect(value.chatEnabled).toBe(true)
  expect(value.model.services.viewer.image).toBe(containers[0].Image)
  expect(value.model.services.viewer.environment.PRIVATE_VALUE).toBe('fixture-secret')
  expect(value.model.volumes.legacy_data).toEqual({ name: 'legacy_data', external: true })
  expect(value.model.services.viewer.command).toEqual(['server.js'])
  expect(value.runtime.viewer.config.Cmd).toEqual(['old-command'])
  expect(value.model.services.viewer.restart).toBe('no')
})
it.each(['Init', 'GroupAdd', 'ShmSize', 'Tty', 'OpenStdin'])('rejects unsupported %s rather than losing it during recovery', field => {
  const containers = observed()
  if (['Tty', 'OpenStdin'].includes(field)) containers[0].Config[field] = true
  else containers[0].HostConfig[field] = field === 'GroupAdd' ? ['123'] : field === 'ShmSize' ? 1024 : true
  expect(() => adoptionModel(containers, { project: 'legacy', destination: '/stage/baseline/source' })).toThrow('unsupported')
})
it('normalizes only deliberate startup, restart and captured-bind changes for exact recovery comparison', () => {
  const containers = observed()
  containers[0].Mounts.push({ Type: 'bind', Source: '/legacy/private.pem', Destination: '/run/private.pem', RW: false, Propagation: 'rprivate' })
  containers[0].HostConfig.Binds.push('/legacy/private.pem:/run/private.pem:ro')
  const record = { ...adoptionModel(containers, { project: 'legacy', destination: '/captured' }), adoption: { legacyRuntime: true } }
  const runtime = adoptedRecoveryRuntime(record)
  expect(runtime.viewer.config.Cmd).toEqual(['server.js'])
  expect(runtime.viewer.host.Binds).toContain('/captured/mounts/viewer-1/private.pem:/run/private.pem:ro')
  expect(runtime.viewer.mounts.find(mount => mount.Type === 'volume')).toEqual(record.runtime.viewer.mounts.find(mount => mount.Type === 'volume'))
  expect(record.runtime.viewer.config.Cmd).toEqual(['old-command'])
})
