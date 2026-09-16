import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { backupPaths, decryptDatabaseBackup } from './database-backups.mjs'

const [manifest] = process.argv.slice(2)
if (!manifest || process.env.CHAT_RESTORE_CONFIRM !== 'replace')
  throw new Error(
    'Usage: CHAT_RESTORE_CONFIRM=replace node scripts/restore-chat.mjs <manifest.json>',
  )
if (!process.env.INTERNAL_AUTH_SECRET)
  throw new Error('INTERNAL_AUTH_SECRET is required')
const { chatPath, directory } = backupPaths()
const lock = `${chatPath}.restore-lock`
mkdirSync(lock, { mode: 0o700 })
const candidate = `${chatPath}.restore-candidate`
let requestPending = false
let ownsBackupLock = false
const backupLock = join(directory, '.backup-lock')
try {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  mkdirSync(backupLock, { mode: 0o700 })
  ownsBackupLock = true
  for (const suffix of ['', '-wal', '-shm'])
    rmSync(`${candidate}${suffix}`, { force: true })
  await decryptDatabaseBackup(resolve(manifest), 'chat', candidate)
  requestPending = true
  const response = await fetch(
    `${process.env.CHAT_RESTORE_URL ?? 'http://127.0.0.1:3000'}/api/internal/chat/restore`,
    {
      method: 'POST',
      headers: { 'x-internal-auth': process.env.INTERNAL_AUTH_SECRET },
    },
  )
  requestPending = false
  if (!response.ok)
    throw new Error(
      'Chat restore failed; inspect Chat health and retry the restore',
    )
  process.stdout.write(
    'Chat restored; validation and retention cleanup completed.\n',
  )
} catch {
  console.error(
    JSON.stringify({
      event: 'chat-restore',
      result: 'failed',
      code: 'RESTORE_FAILED',
    }),
  )
  process.exitCode = 1
} finally {
  if (!requestPending) {
    rmSync(lock, { recursive: true, force: true })
    if (ownsBackupLock) rmSync(backupLock, { recursive: true, force: true })
  }
  // The application owns candidate removal once a request starts. A lost HTTP response
  // must not delete a database that an active restore still needs.
}
