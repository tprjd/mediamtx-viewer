// @vitest-environment node
import { expect, it } from 'vitest'
import { stagingFixture, inspect } from './fixtures/staging-setup.mjs'

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
