import Database from 'better-sqlite3'
import { readdirSync } from 'node:fs'
import { validateDatabase } from './database-backups.mjs'
import { purgeExpiredChat } from './chat-retention.mjs'

const database = new Database(process.argv[2], { fileMustExist: true })
try {
  database.pragma('foreign_keys = ON')
  validateDatabase(
    database,
    readdirSync('chat-migrations')
      .filter((name) => name.endsWith('.sql'))
      .sort(),
  )
  purgeExpiredChat(database)
  database.prepare('DELETE FROM chat_outbox').run()
  database.pragma('wal_checkpoint(TRUNCATE)')
  database.pragma('journal_mode = DELETE')
} catch {
  console.error('CHAT_RESTORE_PREPARATION_FAILED')
  process.exitCode = 1
} finally {
  database.close()
}
