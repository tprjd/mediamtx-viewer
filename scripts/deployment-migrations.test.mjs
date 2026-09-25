// @vitest-environment node
import { expect, it } from 'vitest'
import { stagingFixture, inspect, docker } from './fixtures/staging-setup.mjs'

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
