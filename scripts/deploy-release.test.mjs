// @vitest-environment node
import { expect, it } from 'vitest'
import { stagingFixture, inspect } from './fixtures/staging-setup.mjs'

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
