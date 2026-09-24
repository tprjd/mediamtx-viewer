import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Shared by scheduled backups, maintenance backups, and both explicit restores.
// Keep the existing lock location so already installed daily jobs also participate.
export function acquireBackupOperation(directory, authPath) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const lock = join(directory, '.backup-lock')
  mkdirSync(lock, { mode: 0o700 })
  const release = () => rmSync(lock, { recursive: true, force: true })
  if (existsSync(join(dirname(authPath), '.maintenance-backup.json'))) {
    release()
    throw new Error('Unresolved maintenance operation')
  }
  return release
}
