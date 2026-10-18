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
    expect(deployed.status, deployed.stderr + deployed.diagnostic).toBe(0)
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
