import 'server-only'

import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { chatEnvironment } from '@/lib/chat-environment'

const globalDatabase = globalThis as typeof globalThis & {
  chatDatabase?: Database.Database
}

function createChatDatabase(): Database.Database {
  mkdirSync(dirname(chatEnvironment.databasePath), { recursive: true })
  const database = new Database(chatEnvironment.databasePath)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  database.pragma('busy_timeout = 5000')
  return database
}

export function getChatDatabase(): Database.Database {
  globalDatabase.chatDatabase ??= createChatDatabase()
  return globalDatabase.chatDatabase
}
