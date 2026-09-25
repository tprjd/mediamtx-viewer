// @vitest-environment node
// Long integration checks. Deferred when the operator requests short checks only.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { docker, inspect, run, stagingFixture } from './fixtures/staging-setup.mjs'

it.each([false, true])('adopts the legacy layout and runs the installed daily job from the active release with Chat=%s', async chat => {
  await stagingFixture(async ({ command, project, directory, viewer, fault, url }) => {
    const before = inspect(viewer)
    const adopted = await command('adopt')
    expect(adopted.status, adopted.stderr + adopted.diagnostic).toBe(0)
    expect(JSON.parse(adopted.stdout)).toMatchObject({ result: 'active', chatEnabled: chat, adoption: { githubVerified: false, legacyRuntime: true } })
    expect(inspect(viewer).Id).toBe(before.Id)
    expect(inspect(viewer).Mounts).toEqual(before.Mounts)
    expect(inspect(viewer).HostConfig.RestartPolicy.Name).toBe('no')
    const runner = join(directory, 'host-jobs/usr/local/libexec/mediamtx-active-backup')
    expect(existsSync(runner)).toBe(true)
    expect(readFileSync(join(directory, 'host-jobs/etc/systemd/system/mediamtx-backup.service'), 'utf8')).not.toContain('/old/checkout')
    const backup = () => {
      const manifest = run('sh', [runner, project])
      const set = JSON.parse(docker('exec', `${project}-viewer-1`, 'cat', manifest))
      expect(Object.keys(set.databases).sort()).toEqual(['auth', 'chat'])
      for (const name of ['auth', 'chat']) expect(Number(docker('exec', `${project}-viewer-1`, 'stat', '-c', '%s', join(manifest, '..', set.databases[name].file)))).toBe(set.databases[name].bytes)
    }
    backup()
    fault('activation-failure')
    const failed = await command('managed')
    expect(failed.status).not.toBe(0)
    expect(JSON.parse(failed.stderr).result).toBe('failed-rolled-back')
    expect(inspect(`${project}-viewer-1`).Image).toBe(before.Image)
    expect(inspect(`${project}-viewer-1`).Config.Cmd).toEqual(['server.js'])
    fault('')
    const deployed = await command('managed')
    expect(deployed.status, deployed.stderr + deployed.diagnostic).toBe(0)
    expect(JSON.parse(deployed.stdout).retention.host.releases).toHaveLength(2)
    expect(inspect(`${project}-viewer-1`).Image).not.toBe(before.Image)
    expect((await (await fetch(`${url}/_fixture-health`)).json()).version).toBe('1.2.3')
    expect(inspect(`${project}-viewer-1`).Config.Env).toContain(`CHAT_ENABLED=${chat}`)
    backup()
  }, { managed: true, legacy: true, chat })
}, 600000)

it('keeps public maintenance after a migrated first deployment and recovers the candidate after reconnecting', async () => {
  await stagingFixture(async ({ command, fault, url, project }) => {
    expect((await command('adopt')).status).toBe(0)
    fault('interrupt-chat')
    expect((await command('managed')).status).not.toBe(0)
    expect((await fetch(url)).status).toBe(503)
    const unsafe = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(unsafe.status).not.toBe(0)
    expect((await fetch(url)).status).toBe(503)
    fault('')
    const recovered = await command('recover', {}, ['--release', 'candidate', '--restore', 'none'])
    expect(recovered.status, recovered.stderr + recovered.diagnostic).toBe(0)
    expect(JSON.parse(recovered.stdout).retention.host.releases).toHaveLength(2)
    expect(docker('exec', `${project}-viewer-1`, 'node', '-e', "const D=require('better-sqlite3'); console.log(new D('/data/auth.sqlite').prepare('SELECT value FROM adoption_marker').get().value)")).toBe('preserved')
    expect((await fetch(url)).status).toBe(200)
  }, { managed: true, legacy: true, migrations: { 'migrations/900_adoption.sql': "CREATE TABLE adoption_marker (value); INSERT INTO adoption_marker VALUES ('preserved');" } })
}, 600000)

it('keeps legacy services running when adoption and a retry fail preflight, then resumes the same adoption', async () => {
  await stagingFixture(async ({ command, fault, viewer, url }) => {
    const before = inspect(viewer)
    fault('host-space')
    const failed = await command('adopt')
    expect(failed.status).not.toBe(0)
    expect(JSON.parse(failed.stderr).phase).toBe('adopting')
    const retry = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(retry.status).not.toBe(0)
    expect(JSON.parse(retry.stderr).phase).toBe('adopting')
    expect(inspect(viewer).Id).toBe(before.Id)
    expect(inspect(viewer).State.Running).toBe(true)
    expect((await fetch(url)).status).toBe(200)
    fault('')
    const recovered = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(recovered.status, recovered.stderr + recovered.diagnostic).toBe(0)
    expect(JSON.parse(recovered.stdout).adoption.githubVerified).toBe(false)
  }, { managed: true, legacy: true })
}, 300000)
