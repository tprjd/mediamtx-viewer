// @vitest-environment node
import { expect, it } from 'vitest'
import { stagingFixture, inspect, docker } from './fixtures/staging-setup.mjs'

it('rejects an unmanaged installation before changing live state', async () => {
  await stagingFixture(async ({ command, viewer }) => {
    const before = inspect(viewer)
    const result = await command('managed')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('managed baseline')
    expect(inspect(viewer).State.StartedAt).toBe(before.State.StartedAt)
    expect(inspect(viewer).State.Paused).toBe(false)
  })
}, 240000)

it.each([false, true])('activates a selected release with Chat=%s and preserves database contents', async chat => {
  await stagingFixture(async ({ command, url }) => {
    const before = await (await fetch(url)).json()
    const result = await command('managed')
    expect(result.status, result.stderr + result.diagnostic).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ result: 'active', version: '1.2.3', chatEnabled: chat })
    expect(await (await fetch(`${url}/_fixture-health`)).json()).toMatchObject({ version: '1.2.3', chat: { status: chat ? 'healthy' : 'disabled' } })
    expect(JSON.parse((await command('status')).stdout)).toMatchObject({ result: 'active', phase: 'complete' })
    const after = await (await fetch(url)).json()
    expect(after.expired).toBe(before.expired)
    expect(after.writes).toBeGreaterThanOrEqual(before.writes)
  }, { managed: true, chat })
}, 240000)

it.each(['wrong-version', 'unhealthy-service', 'degraded-chat', 'activation-failure', 'static-proxy'])('returns failure after exact rollback for %s', async failure => {
  await stagingFixture(async ({ command, url, fault, viewer, project }) => {
    const original = inspect(viewer)
    const before = await (await fetch(url)).json()
    fault(failure)
    const result = await command('managed')
    expect(result.status).not.toBe(0)
    expect(JSON.parse(result.stderr), result.stderr + result.diagnostic).toMatchObject({ result: 'failed-rolled-back', failedPhase: 'activation' })
    expect(inspect(viewer).Image).toBe(original.Image)
    expect(inspect(viewer).Config.Env.sort()).toEqual(original.Config.Env.sort())
    expect(inspect(viewer).Mounts.sort((a, b) => a.Destination.localeCompare(b.Destination))).toEqual(original.Mounts.sort((a, b) => a.Destination.localeCompare(b.Destination)))
    expect(docker('exec', `${project}-discord-notifier-1`, 'cat', '/app/discord-notifier.mjs')).toBe('// previous mounted notifier script')
    const response = await fetch(url)
    expect(response.headers.get('x-fixture-release')).toBe('previous')
    const after = await response.json()
    expect(after.expired).toBe(before.expired)
    expect(after.writes).toBeGreaterThanOrEqual(before.writes)
    expect(await (await fetch(`${url}/_fixture-health`)).json()).toMatchObject({ version: 'fixture', chat: { status: 'healthy' } })
    expect(result.stdout + result.stderr).not.toContain('fixture-private')
  }, { managed: true, chat: true })
}, 240000)

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

it.each(['transfer-failure', 'pending-migrations', 'backup-key'])('rejects %s without activating the selected release', async failure => {
  await stagingFixture(async ({ command, viewer, url, fault }) => {
    const before = inspect(viewer)
    fault(failure)
    const result = await command('managed')
    expect(result.status).not.toBe(0)
    expect(JSON.parse(result.stderr), result.stderr + result.diagnostic).toMatchObject({ result: 'rejected', failedPhase: failure === 'transfer-failure' ? 'maintenance-backup' : failure === 'backup-key' ? 'staging' : 'migration-preflight' })
    expect(inspect(viewer).Id).toBe(before.Id)
    expect(inspect(viewer).State.StartedAt).toBe(before.State.StartedAt)
    expect(inspect(viewer).State.Paused).toBe(false)
    expect((await fetch(url)).status).toBe(200)
  }, { managed: true })
}, 240000)


it('verifies a fresh MediaMTX health result after publishing its ports', async () => {
  await stagingFixture(async ({ command, project }) => {
    const result = await command('managed')
    expect(result.status, result.stderr + result.diagnostic).toBe(0)
    const media = inspect(`${project}-mediamtx-1`)
    expect(media.NetworkSettings.Ports['1935/tcp']).toHaveLength(1)
    const health = inspect(`${project}-mediamtx-health-1`).State.Health
    expect(health.Status).toBe('healthy')
    expect(health.Log.some(check => check.ExitCode === 0 && Date.parse(check.Start) >= Date.parse(media.State.StartedAt))).toBe(true)
  }, { managed: true, mediaPorts: true })
}, 240000)
