// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('allows viewer startup after an optional Chat migration fails and logs only an error code', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chat-migration-'))
  try {
    const env = { ...process.env, CHAT_DB_PATH: directory }
    const required = spawnSync(process.execPath, ['scripts/migrate-chat.mjs'], {
      env,
      encoding: 'utf8',
    })
    expect(required.status).not.toBe(0)
    const optional = spawnSync(
      process.execPath,
      ['scripts/migrate-chat.mjs', '--optional'],
      { env, encoding: 'utf8' },
    )
    expect(optional.status).toBe(0)
    expect(optional.stderr).toBe(
      '{"event":"chat-migration","result":"failed","code":"MIGRATION_FAILED"}\n',
    )
    expect(optional.stderr).not.toContain(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
