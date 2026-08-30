import Database from 'better-sqlite3'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createCipheriv, randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'

const databasePath = resolve(process.env.AUTH_DB_PATH ?? '.data/auth.sqlite')
const backupDirectory = resolve(process.env.AUTH_BACKUP_DIR ?? '.data/backups')
const key = Buffer.from(process.env.AUTH_BACKUP_KEY ?? '', 'base64')
if (key.length !== 32) {
  throw new Error('AUTH_BACKUP_KEY must be a base64-encoded 32-byte key')
}

mkdirSync(backupDirectory, { recursive: true })
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const snapshotPath = join(backupDirectory, `.auth-${stamp}.sqlite`)
const finalPath = join(backupDirectory, `auth-${stamp}.sqlite.enc`)
const temporaryPath = `${finalPath}.tmp`

const database = new Database(databasePath, { readonly: true })
await database.backup(snapshotPath)
database.close()

const iv = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm', key, iv)
const ciphertext = Buffer.concat([
  cipher.update(readFileSync(snapshotPath)),
  cipher.final(),
])
const tag = cipher.getAuthTag()
writeFileSync(
  temporaryPath,
  Buffer.concat([Buffer.from('MTXAUTH1'), iv, tag, ciphertext]),
  { mode: 0o600 },
)
chmodSync(temporaryPath, 0o600)
renameSync(temporaryPath, finalPath)
unlinkSync(snapshotPath)

const backups = readdirSync(backupDirectory)
  .filter((name) => name.startsWith('auth-') && name.endsWith('.sqlite.enc'))
  .sort()
for (const oldBackup of backups.slice(0, Math.max(0, backups.length - 7))) {
  unlinkSync(join(backupDirectory, oldBackup))
}

process.stdout.write(`${finalPath}\n`)
