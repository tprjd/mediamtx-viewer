// @vitest-environment node

import { expect, it } from 'vitest'
import { stagingFixture, inspect, docker } from './fixtures/staging-setup.mjs'

it.each(['chat-enable', 'chat-disable'])('stops Chat safely on baseline drift during %s', async action => {
  await stagingFixture(async ({ command, project, image, viewer }) => {
    const drift = operation => docker('run', '--rm', '--user', '0', '-v', `${project}-deployment-staging:/stage`, '--entrypoint', 'node', image,
      '-e', operation === 'add' ? "require('fs').writeFileSync('/stage/baseline/source/drift','changed')" : "require('fs').unlinkSync('/stage/baseline/source/drift')")
    drift('add')
    const result = await command(action)
    expect(result.status).not.toBe(0)
    expect(inspect(`${project}-centrifugo-1`).State.Running).toBe(false)
    expect(inspect(viewer).State.Running).toBe(false)
    expect(JSON.parse(result.stderr)).toMatchObject({ result: 'chat-recovery-required', chatEnabled: true })
    expect(inspect(`${project}-deploy-operation`).State.Running).toBe(true)
    expect(JSON.parse((await command('status')).stdout).result).toBe('chat-recovery-required')
    drift('remove')
    const recovered = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(recovered.status, recovered.stderr).toBe(0)
    expect(JSON.parse((await command('chat-health')).stdout)).toMatchObject({ chatEnabled: true, chat: { status: 'healthy' } })
  }, { managed: true, chat: true })
}, 240000)

it('stops the replacement viewer when failed-enable cleanup also fails', async () => {
  await stagingFixture(async ({ command, project, viewer, fault }) => {
    const deployed = await command('managed')
    expect(deployed.status, deployed.stderr + deployed.diagnostic).toBe(0)
    const original = inspect(viewer).Id
    fault('chat-cleanup')
    const result = await command('chat-enable')
    expect(result.status).not.toBe(0)
    expect(JSON.parse(result.stderr).result).toBe('chat-recovery-required')
    expect(inspect(viewer).Id).not.toBe(original)
    expect(inspect(viewer).State.Running).toBe(false)
    expect(inspect(`${project}-centrifugo-1`).State.Running).toBe(false)
    fault('')
    const recovered = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(recovered.status, recovered.stderr).toBe(0)
    expect(JSON.parse((await command('chat-health')).stdout).chat.status).toBe('disabled')
  }, { managed: true })
}, 240000)

it('does not recover an interrupted Chat command through another maintenance owner', async () => {
  await stagingFixture(async ({ command, viewer, fault }) => {
    fault('interrupt-chat-lock')
    expect((await command('chat-disable')).status).not.toBe(0)
    fault('')
    const before = inspect(viewer).State.StartedAt
    docker('exec', viewer, 'node', '-e', "require('fs').writeFileSync('/data/.maintenance-backup.json',JSON.stringify({attempt:'other-owner'}))")
    const recovered = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(recovered.status).not.toBe(0)
    expect(inspect(viewer).State.StartedAt).toBe(before)
    expect(docker('exec', viewer, 'cat', '/data/.maintenance-backup.json')).toContain('other-owner')
  }, { managed: true, chat: true })
}, 240000)

it('keeps completed Chat recovery behind a scheduled backup lock', async () => {
  await stagingFixture(async ({ command, viewer }) => {
    const disabled = await command('chat-disable')
    expect(disabled.status, disabled.stderr).toBe(0)
    // The normal viewer user must still be able to acquire its scheduled backup lock.
    docker('exec', viewer, 'mkdir', '/data/backups/.backup-lock')
    docker('stop', '-t', '1', viewer)
    const recovered = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(recovered.status).not.toBe(0)
    expect(recovered.stderr).toContain('Managed Chat backup lock unavailable')
    expect(inspect(viewer).State.Running).toBe(false)
  }, { managed: true, chat: true })
}, 240000)
