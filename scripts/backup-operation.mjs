import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Shared by scheduled backups, maintenance backups, and both explicit restores.
// Keep the existing lock location so already installed daily jobs also participate.
export function acquireBackupOperation(directory, authPath, { maintenanceAttempt } = {}) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const lock = join(directory, '.backup-lock')
  if (maintenanceAttempt) {
    const state = JSON.parse(readFileSync(join(dirname(authPath), '.maintenance-backup.json'), 'utf8'))
    if (state.attempt !== maintenanceAttempt || state.phase !== 'held' || !existsSync(lock)) throw new Error('Maintenance owner differs')
    const recoveryLock = join(directory, '.recovery-lock')
    mkdirSync(recoveryLock, { mode: 0o700 })
    return () => rmSync(recoveryLock, { recursive: true, force: true })
  }
  mkdirSync(lock, { mode: 0o700 })
  const release = () => rmSync(lock, { recursive: true, force: true })
  if (existsSync(join(dirname(authPath), '.maintenance-backup.json'))) {
    release()
    throw new Error('Unresolved maintenance operation')
  }
  return release
}
