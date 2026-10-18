// @vitest-environment node
import { expect, it } from 'vitest'
import { stagingFixture, inspect, docker } from './fixtures/staging-setup.mjs'

it.each(['wrong-version', 'unhealthy-service', 'degraded-chat', 'activation-failure', 'static-proxy', 'pending-migrations'])('returns failure after exact rollback for %s', async failure => {
  await stagingFixture(async ({ command, url, fault, viewer, project }) => {
    const original = inspect(viewer)
    const before = await (await fetch(url)).json()
    fault(failure)
    const result = await command('managed')
    expect(result.status).not.toBe(0)
    expect(JSON.parse(result.stderr), result.stderr + result.diagnostic).toMatchObject({ result: 'failed-rolled-back', failedPhase: failure === 'pending-migrations' ? 'migration-chat' : 'activation' })
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
