import { resolve } from 'node:path'
import { verifyBackupSet } from './backup-verification.mjs'
try {
  const [path] = process.argv.slice(2)
  if (!path) throw new Error('Select a manifest')
  const manifest = await verifyBackupSet(resolve(path))
  process.stdout.write(`${JSON.stringify({ result: 'verified', backupId: manifest.id })}\n`)
} catch {
  console.error(JSON.stringify({ result: 'failed', code: 'BACKUP_VERIFICATION_FAILED' }))
  process.exitCode = 1
}
