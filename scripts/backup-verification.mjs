import { chmodSync, mkdtempSync, rmSync, statfsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { backupKey, decryptDatabaseBackup, readBackupManifest } from './database-backups.mjs'

export function requireSpace(path, bytes, files = 32) {
  const space = statfsSync(path)
  const available = space.bavail * space.bsize
  if (![bytes, files, available, space.files, space.ffree].every(Number.isSafeInteger) || bytes < 0 || files < 0 ||
      available < bytes || space.files <= 0 || space.ffree < files) throw new Error('Insufficient backup space')
}

export async function verifyBackupSet(manifestPath, key = backupKey()) {
  const manifest = await readBackupManifest(manifestPath, key)
  const directory = dirname(manifestPath)
  requireSpace(directory, 3 * (manifest.databases.auth.bytes + manifest.databases.chat.bytes) + 64 * 1024 * 1024)
  const temporary = mkdtempSync(join(directory, '.verify-'))
  chmodSync(temporary, 0o700)
  try {
    for (const name of ['auth', 'chat']) {
      await decryptDatabaseBackup(manifestPath, name, join(temporary, `${name}.sqlite`), key)
    }
    return manifest
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
