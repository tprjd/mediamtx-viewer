// @vitest-environment node
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { stagingFixture, inspect, docker } from './fixtures/staging-setup.mjs'

it('enables Chat without capacity reports and preserves its state across activation', async () => {
  await stagingFixture(async ({ command, project, directory, viewer }) => {
    const units = join(directory, 'trial-units.json')
    writeFileSync(units, JSON.stringify(['chat-capacity-rollback.timer', 'chat-capacity-rollback.service']))
    const deployed = await command('managed')
    expect(deployed.status, deployed.stderr).toBe(0)
    expect(JSON.parse(readFileSync(units, 'utf8'))).toEqual([])
    writeFileSync(units, JSON.stringify(['chat-capacity-rollback.timer', 'chat-capacity-rollback.service']))
    const enabled = await command('chat-enable')
    expect(enabled.status, enabled.stderr).toBe(0)
    expect(JSON.parse(enabled.stdout)).toMatchObject({ chatEnabled: true, capacity: 'unverified' })
    expect(JSON.parse((await command('chat-health')).stdout)).toMatchObject({ chatEnabled: true, chat: { status: 'healthy' } })
    expect(inspect(`${project}-centrifugo-1`).State.Running).toBe(true)
    expect(JSON.parse(readFileSync(units, 'utf8'))).toEqual([])
    docker('exec', viewer, 'touch', '/data/unhealthy')
    const degraded = await command('chat-health')
    expect(degraded.status).not.toBe(0)
    expect(JSON.parse(degraded.stdout).chat.status).toBe('degraded')
    docker('exec', viewer, 'rm', '/data/unhealthy')
    docker('stop', '-t', '1', viewer)
    const unavailable = await command('chat-health')
    expect(unavailable.status).not.toBe(0)
    expect(JSON.parse(unavailable.stdout).chat.status).toBe('unavailable')
    docker('start', viewer)

    const next = await command('managed')
    expect(next.status, next.stderr).toBe(0)
    expect(JSON.parse(next.stdout).chatEnabled).toBe(true)
  }, { managed: true })
}, 240000)

it('refuses Chat changes during maintenance and preserves its recovery marker', async () => {
  await stagingFixture(async ({ command, viewer }) => {
    docker('exec', viewer, 'node', '-e', "require('fs').writeFileSync('/data/.maintenance-backup.json',JSON.stringify({attempt:'protected-recovery'}))")
    const result = await command('chat-disable')
    expect(result.status).not.toBe(0)
    expect(docker('exec', viewer, 'cat', '/data/.maintenance-backup.json')).toContain('protected-recovery')
  }, { managed: true, chat: true })
}, 240000)

it('cancels only obsolete trial units when explicitly disabling Chat', async () => {
  await stagingFixture(async ({ command, directory, project }) => {
    const units = join(directory, 'trial-units.json')
    writeFileSync(units, JSON.stringify(['chat-capacity-rollback.timer', 'chat-capacity-rollback.service', 'mediamtx-backup.timer']))
    const result = await command('chat-disable')
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(readFileSync(units, 'utf8'))).toEqual(['mediamtx-backup.timer'])
    expect(inspect(`${project}-centrifugo-1`).State.Running).toBe(false)
    expect(JSON.parse((await command('chat-health')).stdout)).toMatchObject({ chatEnabled: false, chat: { status: 'disabled' } })
  }, { managed: true, chat: true })
}, 240000)

it('rejects retained enable safeguards and leaves Chat safely disabled', async () => {
  await stagingFixture(async ({ command, fault, project, viewer }) => {
    const deployed = await command('managed')
    expect(deployed.status, deployed.stderr).toBe(0)
    for (const failure of ['stale', 'checks', 'tag', 'digest', 'image-source', 'architecture', 'host-architecture',
      'host-memory', 'host-cpu', 'host-space', 'database-limit', 'broker-health', 'degraded-chat']) {
      fault(failure)
      const result = await command('chat-enable')
      expect(result.status, failure + result.stdout).not.toBe(0)
      expect(JSON.parse(result.stderr || result.stdout), failure).toMatchObject({ result: 'failed-disabled', chatEnabled: false })
      expect(inspect(`${project}-centrifugo-1`).State.Running, failure).toBe(false)
      fault('')
      expect(JSON.parse((await command('chat-health')).stdout).chat.status, failure).toBe('disabled')
    }
    expect(JSON.parse((await command('status')).stdout)).toMatchObject({ result: 'failed-disabled', owner: 'none', chatEnabled: false })
    for (const reference of [null, 'missing-message']) {
      docker('exec', viewer, 'node', '-e', "const D=require('better-sqlite3');const d=new D('/data/chat.sqlite');d.pragma('foreign_keys=OFF');d.prepare('INSERT INTO chat_outbox(id,message_id,channel_name,payload,next_attempt_at,created_at) VALUES (?,?,?,?,0,0)').run('blocked',JSON.parse(process.argv[1]),'room','{}')", JSON.stringify(reference))
      const result = await command('chat-enable')
      expect(result.status).not.toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ result: 'failed-disabled', reason: 'Database integrity or Chat outbox check failed' })
      docker('exec', viewer, 'node', '-e', "const D=require('better-sqlite3');new D('/data/chat.sqlite').exec('DELETE FROM chat_outbox')")
    }
  }, { managed: true })
}, 600000)

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
    expect(deployed.status, deployed.stderr).toBe(0)
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
