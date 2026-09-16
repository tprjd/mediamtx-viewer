// Keep the existing command name so installed daily jobs include both databases.
import { backupPaths, createBackupSet } from './database-backups.mjs'
try {
  process.stdout.write(`${await createBackupSet(backupPaths())}\n`)
} catch {
  console.error(
    JSON.stringify({
      event: 'database-backup',
      result: 'failed',
      code: 'BACKUP_FAILED',
    }),
  )
  process.exitCode = 1
}
