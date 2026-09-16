import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { purgeExpiredChat } from './chat-retention.mjs'

const path = process.argv[2]
let database
try {
  if (existsSync(`${path}.maintenance`))
    throw new Error('Chat restore in progress')
  database = new Database(path, { fileMustExist: true, timeout: 100 })
  database.pragma('foreign_keys = ON')
  purgeExpiredChat(database)
} catch {
  console.error('CHAT_CLEANUP_FAILED')
  process.exitCode = 1
} finally {
  database?.close()
}
