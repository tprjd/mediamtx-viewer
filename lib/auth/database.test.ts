// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const connections: Database.Database[] = []
const directories: string[] = []
const shared = globalThis as typeof globalThis & { authDatabase?: Database.Database }

afterEach(() => {
  shared.authDatabase?.close()
  delete shared.authDatabase
  for (const connection of connections.splice(0)) connection.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.resetModules()
})

function databasePath() {
  const directory = mkdtempSync(join(tmpdir(), 'auth-build-test-'))
  directories.push(directory)
  const path = join(directory, 'auth.sqlite')
  vi.stubEnv('AUTH_DB_PATH', path)
  return path
}

it('loads build routes without opening a locked runtime database', async () => {
  const locked = new Database(databasePath())
  connections.push(locked)
  locked.exec('CREATE TABLE probe (value TEXT); BEGIN EXCLUSIVE')
  vi.stubEnv('NEXT_PHASE', 'phase-production-build')
  const { getDatabase } = await import('./database')
  expect(getDatabase().prepare('SELECT 1 AS value').get()).toEqual({ value: 1 })
  expect(locked.inTransaction).toBe(true)
})

it('persists server writes in the configured runtime database', async () => {
  const path = databasePath()
  vi.stubEnv('NEXT_PHASE', 'phase-production-server')
  const { getDatabase } = await import('./database')
  getDatabase().exec("CREATE TABLE probe (value TEXT); INSERT INTO probe VALUES ('persisted')")
  shared.authDatabase?.close()
  delete shared.authDatabase
  const reopened = new Database(path, { readonly: true })
  connections.push(reopened)
  expect(reopened.prepare('SELECT value FROM probe').get()).toEqual({ value: 'persisted' })
})
