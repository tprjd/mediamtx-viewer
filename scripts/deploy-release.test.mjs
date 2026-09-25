// @vitest-environment node
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, it } from 'vitest'
import { stagingFixture, inspect, docker, run } from './fixtures/staging-setup.mjs'

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

it('runs authentication and Chat migrations before acceptance', async () => {
  await stagingFixture(async ({ command }) => {
    const result = await command('managed')
    expect(result.status, result.stderr + result.diagnostic).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ result: 'active', migrationChanges: {
      auth: { added: ['900_deploy.sql'], changed: false }, chat: { added: ['900_deploy.sql'], changed: false },
    } })
  }, { managed: true, migrations: {
    'migrations/900_deploy.sql': 'CREATE TABLE deployment_auth (id INTEGER);',
    'chat-migrations/900_deploy.sql': 'CREATE TABLE deployment_chat (id INTEGER);',
  } })
}, 240000)

it.each([
  ['first-file failure', { 'migrations/900_fail.sql': 'CREATE TABLE tentative (id); SELECT * FROM missing_table;' }, 'failed-rolled-back', 'migration-auth', [], []],
  ['partial sequence', { 'migrations/900_ok.sql': 'CREATE TABLE committed (id);', 'migrations/901_fail.sql': 'SELECT * FROM missing_table;' }, 'maintenance-required', 'migration-auth', ['900_ok.sql'], []],
  ['authentication success then Chat failure', { 'migrations/900_ok.sql': 'CREATE TABLE committed (id);', 'chat-migrations/900_fail.sql': 'SELECT * FROM missing_table;' }, 'maintenance-required', 'migration-chat', ['900_ok.sql'], []],
  ['Chat first-file failure', { 'chat-migrations/900_fail.sql': 'SELECT * FROM missing_table;' }, 'failed-rolled-back', 'migration-chat', [], []],
  ['Chat partial success', { 'chat-migrations/900_ok.sql': 'CREATE TABLE committed (id);', 'chat-migrations/901_fail.sql': 'SELECT * FROM missing_table;' }, 'maintenance-required', 'migration-chat', [], ['900_ok.sql']],
  ['unreadable records', { 'migrations/900_fail.sql': "UPDATE app_migration SET applied_at = 'unreadable';" }, 'maintenance-required', 'migration-chat', [], []],
])('handles %s using real applied records', async (name, migrations, outcome, phase, auth, chat) => {
  await stagingFixture(async ({ command, url, viewer }) => {
    const oldImage = inspect(viewer).Image
    const result = await command('managed')
    expect(result.status).not.toBe(0)
    const report = JSON.parse(result.stderr)
    expect(report, result.stderr + result.diagnostic).toMatchObject({ result: outcome, failedPhase: phase,
      migrationChanges: { auth: { added: auth }, chat: { added: chat } } })
    if (outcome === 'maintenance-required') {
      expect((await fetch(url, { method: 'POST' })).status).toBe(503)
      expect(inspect(viewer).State.Running).toBe(false)
      const retry = await command('managed')
      expect(retry.status).not.toBe(0)
      expect(JSON.parse((await command('status')).stdout)).toMatchObject({ result: outcome, failedPhase: phase })
    } else {
      expect(inspect(viewer).Image).toBe(oldImage)
      expect((await fetch(url)).status).toBe(200)
    }
  }, { managed: true, chat: true, migrations })
}, 240000)

it('keeps committed authentication data after activation failure and restores only authentication by explicit choice', async () => {
  await stagingFixture(async ({ command, fault, url, project }) => {
    fault('activation-failure')
    const result = await command('managed')
    const report = JSON.parse(result.stderr)
    expect(report, result.stderr + result.diagnostic).toMatchObject({ result: 'maintenance-required', failedPhase: 'activation',
      migrationChanges: { auth: { added: ['900_ok.sql'] }, chat: { added: [] } } })
    expect((await fetch(url, { method: 'POST' })).status).toBe(503)
    const helper = `maintenance-tool-${report.backup.attempt}`
    const query = code => docker('exec', helper, 'node', '-e', code)
    expect(query("const D=require('better-sqlite3');console.log(new D('/data/auth.sqlite').prepare('SELECT value FROM committed').get().value)")).toBe('retained')
    query("const D=require('better-sqlite3');new D('/data/chat.sqlite').exec(\"INSERT INTO fixture_writes(source) VALUES ('keep-through-restore')\")")
    const denied = await command('recover', {}, ['--release', 'previous', '--restore', 'auth'])
    expect(denied.status).not.toBe(0)
    expect(denied.stderr).toContain('discard later data')
    const incompatible = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(incompatible.status).not.toBe(0)
    expect((await fetch(url)).status).toBe(503)
    fault('')
    const recovered = await command('recover', {}, ['--release', 'previous', '--restore', 'auth', '--confirm', 'discard-later-data'])
    expect(recovered.status, recovered.stderr + recovered.diagnostic).toBe(0)
    expect(JSON.parse(recovered.stdout)).toMatchObject({ result: 'recovered', version: 'fixture' })
    expect(docker('exec', `${project}-viewer-1`, 'node', '-e', "const D=require('better-sqlite3');console.log(new D('/data/chat.sqlite').prepare(\"SELECT count(*) AS n FROM fixture_writes WHERE source='keep-through-restore'\").get().n)")).toBe('1')
    expect((await fetch(url)).status).toBe(200)
  }, { managed: true, chat: true, migrations: { 'migrations/900_ok.sql': "CREATE TABLE committed (value); INSERT INTO committed VALUES ('retained');" } })
}, 240000)

it('recovers the migrated candidate without replacing either database', async () => {
  await stagingFixture(async ({ command, fault, url }) => {
    fault('activation-failure')
    expect(JSON.parse((await command('managed')).stderr)).toMatchObject({ result: 'maintenance-required' })
    fault('')
    const recovered = await command('recover', {}, ['--release', 'candidate', '--restore', 'none'])
    expect(recovered.status, recovered.stderr + recovered.diagnostic).toBe(0)
    expect(JSON.parse(recovered.stdout)).toMatchObject({ result: 'recovered', version: '1.2.3', recovery: { databases: 'none' } })
    expect(await (await fetch(`${url}/_fixture-health`)).json()).toMatchObject({ version: '1.2.3' })
  }, { managed: true, migrations: { 'chat-migrations/900_ok.sql': 'CREATE TABLE committed (id);' } })
}, 240000)

it('restores only Chat offline, retains replaced files, and purges expired messages', async () => {
  await stagingFixture(async ({ command, fault, url, project }) => {
    fault('activation-failure')
    const report = JSON.parse((await command('managed')).stderr)
    expect(report).toMatchObject({ result: 'maintenance-required' })
    const helper = `maintenance-tool-${report.backup.attempt}`
    docker('exec', helper, 'node', '-e', "const D=require('better-sqlite3');new D('/data/auth.sqlite').exec(\"UPDATE user SET name='keep-auth' WHERE id='account'\")")
    fault('')
    const recovered = await command('recover', {}, ['--release', 'previous', '--restore', 'chat', '--confirm', 'discard-later-data'])
    expect(recovered.status, recovered.stderr + recovered.diagnostic).toBe(0)
    expect((await (await fetch(url)).json()).expired).toBe(0)
    const contents = JSON.parse(docker('exec', `${project}-viewer-1`, 'node', '-e', "const D=require('better-sqlite3'),f=require('fs');console.log(JSON.stringify({name:new D('/data/auth.sqlite').prepare(\"SELECT name FROM user WHERE id='account'\").get().name,files:f.readdirSync('/data')}))"))
    expect(contents.name).toBe('keep-auth')
    expect(contents.files.some(file => file.startsWith('chat.sqlite.pre-restore-'))).toBe(true)
    expect(contents.files.some(file => file.startsWith('auth.sqlite.pre-restore-'))).toBe(false)
    expect(contents.files).toContain('chat.sqlite.generation')
  }, { managed: true, chat: true, migrations: { 'chat-migrations/900_ok.sql': 'CREATE TABLE committed (id);' } })
}, 240000)

it('recovers the original attempt after loss before workstation acknowledgement', async () => {
  await stagingFixture(async ({ command, fault, url }) => {
    fault('interrupt-transfer')
    expect((await command('managed')).status).not.toBe(0)
    const status = await command('status')
    expect(status.status).not.toBe(0)
    const report = JSON.parse(status.stdout)
    expect(report).toMatchObject({ result: 'interrupted', owner: 'abandoned', phase: 'maintenance-backup' })
    expect(report.backup.attempt).toBeTruthy()
    expect(report.backup.acknowledged).toBe(false)
    expect((await fetch(url)).status).toBe(503)
    expect((await command('managed')).status).not.toBe(0)
    fault('')
    const recovered = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(recovered.status, recovered.stderr + recovered.diagnostic).toBe(0)
    expect(JSON.parse(recovered.stdout)).toMatchObject({ attempt: report.attempt, result: 'recovered' })
    expect((await fetch(url)).status).toBe(200)
  }, { managed: true })
}, 240000)

it.each(['interrupt-chat', 'interrupt-activation', 'interrupt-completion', 'interrupt-helper-cleanup', 'interrupt-proxy-cleanup'])('reconciles %s without repeating committed migrations', async failure => {
  await stagingFixture(async ({ command, fault, url, project }) => {
    fault(failure)
    expect((await command('managed')).status).not.toBe(0)
    const report = JSON.parse((await command('status')).stdout)
    expect(report.owner).toBe('abandoned')
    if (failure === 'interrupt-chat') expect(() => run(process.execPath, ['scripts/maintenance-backup.mjs', 'resume', '--project', project, '--attempt', report.backup.attempt])).toThrow(/deploy.sh recover/)
    fault('')
    const recovered = await command('recover', {}, ['--release', 'candidate', '--restore', 'none'])
    expect(recovered.status, recovered.stderr + recovered.diagnostic).toBe(0)
    expect(JSON.parse(recovered.stdout)).toMatchObject({ attempt: report.attempt, result: 'recovered' })
    expect((await fetch(url)).status).toBe(200)
    const repeated = await command('recover', {}, ['--release', 'candidate', '--restore', 'none'])
    expect(repeated.status, repeated.stderr + repeated.diagnostic).toBe(0)
    expect(JSON.parse(repeated.stdout)).toMatchObject({ attempt: report.attempt, result: 'recovered' })
    const wrongChoice = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(wrongChoice.status).not.toBe(0)
    expect((await fetch(url)).status).toBe(200)
    expect(JSON.parse((await command('status')).stdout)).toMatchObject({ attempt: report.attempt, result: 'recovered' })
  }, { managed: true, migrations: {
    'migrations/900_once.sql': 'CREATE TABLE once_auth (id INTEGER PRIMARY KEY); INSERT INTO once_auth VALUES (1);',
    'chat-migrations/900_once.sql': 'CREATE TABLE once_chat (id INTEGER PRIMARY KEY); INSERT INTO once_chat VALUES (1);',
  } })
}, 240000)

it('does not steal an active deployment or let a scheduled backup remove its files', async () => {
  await stagingFixture(async ({ command, fault, directory, url }) => {
    fault('pause-transfer')
    const pending = command('managed')
    try {
      for (let n = 0; n < 600 && !existsSync(join(directory, 'paused')); n++) await delay(100)
      expect(existsSync(join(directory, 'paused'))).toBe(true)
      const status = await command('status')
      expect(status.status).not.toBe(0)
      const report = JSON.parse(status.stdout)
      expect(report.owner).toBe('active')
      expect((await command('recover', {}, ['--release', 'previous', '--restore', 'none'])).status).not.toBe(0)
      expect((await command('managed')).status).not.toBe(0)
      expect((await command('prepare')).status).not.toBe(0)
      expect(() => docker('exec', `maintenance-tool-${report.backup.attempt}`, 'node', '/app/scripts/backup-auth.mjs')).toThrow()
      expect(JSON.parse((await command('status')).stdout)).toMatchObject({ attempt: report.attempt, owner: 'active' })
      expect((await fetch(url)).status).toBe(503)
    } finally { fault('') }
    const result = await pending
    expect(result.status, result.stderr + result.diagnostic).toBe(0)
  }, { managed: true })
}, 240000)

it.each(['interrupt-staging', 'interrupt-maintenance', 'interrupt-rollback'])('recovers the previous release after %s', async failure => {
  await stagingFixture(async ({ command, fault, url }) => {
    fault(failure)
    expect((await command('managed')).status).not.toBe(0)
    const report = JSON.parse((await command('status')).stdout)
    expect(report.owner).toBe('abandoned')
    fault('')
    const recovered = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(recovered.status, recovered.stderr + recovered.diagnostic).toBe(0)
    expect(JSON.parse(recovered.stdout)).toMatchObject({ attempt: report.attempt, result: 'recovered', version: 'fixture' })
    expect((await fetch(url)).status).toBe(200)
  }, { managed: true })
}, 240000)

it.each(['auth', 'chat'])('requires explicit recovery after termination during %s migration', async database => {
  await stagingFixture(async ({ command, fault, url }) => {
    fault(database === 'auth' ? 'interrupt-auth' : 'interrupt-chat-running')
    expect((await command('managed')).status).not.toBe(0)
    const report = JSON.parse((await command('status')).stdout)
    expect(report).toMatchObject({ owner: 'abandoned', phase: `migration-${database}` })
    expect((await fetch(url)).status).toBe(503)
    expect((await command('managed')).status).not.toBe(0)
    fault('')
    const recovered = await command('recover', {}, ['--release', 'previous', '--restore', database, '--confirm', 'discard-later-data'])
    expect(recovered.status, recovered.stderr + recovered.diagnostic).toBe(0)
    expect(JSON.parse(recovered.stdout)).toMatchObject({ attempt: report.attempt, result: 'recovered' })
  }, { managed: true, migrations: {
    [`${database === 'auth' ? 'migrations' : 'chat-migrations'}/900_once.sql`]: 'CREATE TABLE once_migration (id INTEGER PRIMARY KEY); INSERT INTO once_migration VALUES (1);',
    [`${database === 'auth' ? 'migrations' : 'chat-migrations'}/901_slow.sql`]: 'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT sum(x) FROM n;',
  } })
}, 240000)

it('allows a new deployment after a completed automatic rollback', async () => {
  await stagingFixture(async ({ command, fault }) => {
    fault('activation-failure')
    const failed = await command('managed')
    expect(JSON.parse(failed.stderr)).toMatchObject({ result: 'failed-rolled-back' })
    fault('')
    const next = await command('managed')
    expect(next.status, next.stderr + next.diagnostic).toBe(0)
    expect(JSON.parse(next.stdout).attempt).not.toBe(JSON.parse(failed.stderr).attempt)
  }, { managed: true })
}, 240000)

it('rejects an acknowledgement from another attempt before any migration', async () => {
  await stagingFixture(async ({ command, fault, url }) => {
    fault('stale-acknowledgement')
    const result = await command('managed')
    expect(result.status).not.toBe(0)
    expect(JSON.parse(result.stderr)).toMatchObject({ result: 'failed-rolled-back',
      migrationChanges: { auth: { added: [] }, chat: { added: [] } } })
    expect((await (await fetch(`${url}/_fixture-health`)).json()).version).toBe('fixture')
  }, { managed: true, migrations: { 'migrations/900_no_permission.sql': 'CREATE TABLE must_not_run (id);' } })
}, 240000)

it('recovers an attempt interrupted before host tool initialization', async () => {
  await stagingFixture(async ({ command, fault, url }) => {
    fault('interrupt-owner-creation')
    expect((await command('managed')).status).not.toBe(0)
    const report = JSON.parse((await command('status')).stdout)
    expect(report.attempt).toBeTruthy()
    expect(report.owner).toBe('abandoned')
    fault('')
    const recovered = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(recovered.status, recovered.stderr + recovered.diagnostic).toBe(0)
    expect(JSON.parse(recovered.stdout)).toMatchObject({ attempt: report.attempt, result: 'recovered' })
    expect((await fetch(url)).status).toBe(200)
  }, { managed: true })
}, 240000)

it('keeps the lock while an in-flight Docker client outlives the workstation process', async () => {
  await stagingFixture(async ({ command, fault }) => {
    fault('interrupt-inflight')
    let report
    try {
      expect((await command('managed')).status).not.toBe(0)
      report = JSON.parse((await command('status')).stdout)
      expect(report.owner).toBe('active')
      expect((await command('recover', {}, ['--release', 'previous', '--restore', 'none'])).status).not.toBe(0)
    } finally { fault('') }
    for (let n = 0; n < 30; n++) {
      if (JSON.parse((await command('status')).stdout).owner === 'abandoned') break
      await delay(100)
    }
    const recovered = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(recovered.status, recovered.stderr + recovered.diagnostic).toBe(0)
    expect(JSON.parse(recovered.stdout).attempt).toBe(report.attempt)
  }, { managed: true })
}, 240000)
