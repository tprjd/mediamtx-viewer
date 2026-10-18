// @vitest-environment node
import { expect, it } from 'vitest'
import { stagingFixture, run } from './fixtures/staging-setup.mjs'

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
