// @vitest-environment node
import { expect, it } from 'vitest'
import { stagingFixture } from './fixtures/staging-setup.mjs'

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
