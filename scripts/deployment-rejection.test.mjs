// @vitest-environment node
import { expect, it } from 'vitest'
import { stagingFixture, inspect } from './fixtures/staging-setup.mjs'

it.each(['rollback-failure', 'migration-history', 'volume-ownership'])('keeps maintenance and data after %s', async failure => {
  await stagingFixture(async ({ command, url, fault }) => {
    fault(failure)
    const result = await command('managed')
    expect(result.status).not.toBe(0)
    expect(JSON.parse(result.stderr), result.stderr + result.diagnostic).toMatchObject({ result: 'maintenance-required' })
    expect((await fetch(url, { method: 'POST' })).status).toBe(503)
    expect((await command('managed')).status).not.toBe(0)
  }, { managed: true, chat: true })
}, 240000)

it.each(['transfer-failure', 'backup-key'])('rejects %s without activating the selected release', async failure => {
  await stagingFixture(async ({ command, viewer, url, fault }) => {
    const before = inspect(viewer)
    fault(failure)
    const result = await command('managed')
    expect(result.status).not.toBe(0)
    expect(JSON.parse(result.stderr), result.stderr + result.diagnostic).toMatchObject({ result: 'rejected', failedPhase: failure === 'transfer-failure' ? 'maintenance-backup' : failure === 'backup-key' ? 'staging' : 'migration-preflight' })
    const recovery = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(recovery.status).not.toBe(0)
    expect(inspect(viewer).Id).toBe(before.Id)
    expect(inspect(viewer).State.StartedAt).toBe(before.State.StartedAt)
    expect(inspect(viewer).State.Paused).toBe(false)
    expect((await fetch(url)).status).toBe(200)
  }, { managed: true })
}, 240000)
