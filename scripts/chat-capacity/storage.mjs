import Database from 'better-sqlite3'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createBackupSet } from '../database-backups.mjs'

// Use the production schema, indexes, snapshot and encryption code on disposable data.
export async function measureStorageBudget() {
  const directory = mkdtempSync(join(tmpdir(), 'chat-storage-'))
  const chatPath = join(directory, 'chat.sqlite')
  const authPath = join(directory, 'auth.sqlite')
  let db
  try {
    execFileSync(process.execPath, ['scripts/migrate-chat.mjs'], {
      env: { ...process.env, CHAT_DB_PATH: chatPath }, stdio: 'pipe',
    })
    const auth = new Database(authPath)
    auth.exec('CREATE TABLE app_migration(name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)')
    auth.close()
    db = new Database(chatPath)
    const now = Date.now()
    db.pragma('journal_mode = WAL')
    db.exec("INSERT INTO chat_room VALUES ('budget-room', 'budget-channel', 700001, 0)")
    const insert = db.prepare(`INSERT INTO chat_message
      (id, room_id, room_sequence, account_id, profile_name, author_tag, content, created_at, client_idempotency_key)
      VALUES (?, 'budget-room', ?, ?, ?, ?, ?, ?, ?)`)
    const batch = db.transaction(start => {
      for (let i = start; i < start + 1000; i++) {
        insert.run(randomUUID(), i + 1, `participant-${i % 100}`, 'Capacity participant',
          String(i % 100).padStart(4, '0'), 'x'.repeat(500), now - (i % 7) * 86400000, randomUUID())
      }
    })
    for (let i = 0; i < 700000; i += 1000) batch(i)
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
    db = undefined
    const manifestPath = await createBackupSet({authPath, chatPath,
      directory: join(directory, 'backups'), key: randomBytes(32), now: new Date(now)})
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const databaseBytes = statSync(chatPath).size
    const chatBackupBytes = manifest.databases.chat.bytes
    return {dailyMessages: 100000, retainedMessages: 700000, contentBytes: 500,
      databaseBytes, chatBackupBytes,
      // Seven retained sets, one replacement set and two temporary snapshot copies.
      requiredChatBytes: databaseBytes + 10 * chatBackupBytes,
      measuredAt: new Date().toISOString()}
  } finally {
    db?.close()
    rmSync(directory, {recursive: true, force: true})
  }
}
