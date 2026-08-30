import Database from 'better-sqlite3'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'

import { authEnvironment } from '@/lib/auth/env'

const globalDatabase = globalThis as typeof globalThis & {
  authDatabase?: Database.Database
}

function createDatabase(): Database.Database {
  mkdirSync(dirname(authEnvironment.databasePath), { recursive: true })
  const database = new Database(authEnvironment.databasePath)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  database.pragma('busy_timeout = 5000')
  return database
}

export function getDatabase(): Database.Database {
  globalDatabase.authDatabase ??= createDatabase()
  return globalDatabase.authDatabase
}

