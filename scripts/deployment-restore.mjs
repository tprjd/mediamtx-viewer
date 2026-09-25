// Offline recovery. The deployment owner must stop all writers before this runs.
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { chmodSync, chownSync, existsSync, statSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { acquireBackupOperation } from './backup-operation.mjs'
import { decryptDatabaseBackup, validateDatabase } from './database-backups.mjs'
import { purgeExpiredChat } from './chat-retention.mjs'
import { validateChatReferences } from './chat-restore-references.mjs'

const input = JSON.parse(process.argv[2])
let release
const candidates = {}, opened = {}
try {
  if (!Array.isArray(input.selected) || input.selected.some(name => !['auth', 'chat'].includes(name))) throw new Error('Invalid database choice')
  release = acquireBackupOperation(process.env.AUTH_BACKUP_DIR, input.paths.auth, { maintenanceAttempt: input.maintenanceAttempt })
  const stamp = randomUUID()
  for (const name of ['auth', 'chat']) {
    let path = input.paths[name]
    if (input.selected.includes(name)) {
      path = `${path}.restore-${stamp}`
      candidates[name] = path
      await decryptDatabaseBackup(input.manifest, name, path)
    }
    const db = opened[name] = new Database(path, { readonly: !input.selected.includes(name), fileMustExist: true })
    validateDatabase(db, input.expected[name])
    if (name === 'chat' && input.selected.includes(name)) {
      purgeExpiredChat(db)
      db.prepare('DELETE FROM chat_outbox').run()
      db.pragma('wal_checkpoint(TRUNCATE)')
      db.pragma('journal_mode = DELETE')
    }
  }
  await validateChatReferences(opened.chat, opened.auth)
  for (const db of Object.values(opened)) db.close()
  for (const name of input.selected) {
    const path = input.paths[name]
    if (existsSync(path)) {
      const old = statSync(path)
      chmodSync(candidates[name], old.mode)
      chownSync(candidates[name], old.uid, old.gid)
    }
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(`${path}${suffix}`)) renameSync(`${path}${suffix}`, `${path}.pre-restore-${stamp}${suffix}`)
    }
    renameSync(candidates[name], path)
    if (name === 'chat') {
      writeFileSync(`${path}.generation`, randomUUID(), { mode: 0o600 })
      rmSync(`${path}.maintenance`, { force: true })
    }
  }
  console.log(JSON.stringify({ restored: input.selected }))
} catch {
  console.error('Database recovery validation or replacement failed; keep maintenance active')
  process.exitCode = 1
} finally {
  for (const db of Object.values(opened)) if (db.open) db.close()
  for (const path of Object.values(candidates)) for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
  release?.()
}
