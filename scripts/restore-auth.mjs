import Database from 'better-sqlite3'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { createDecipheriv } from 'node:crypto'
import { dirname, resolve } from 'node:path'

const [encryptedPathArgument] = process.argv.slice(2)
if (!encryptedPathArgument) {
  throw new Error('Usage: node scripts/restore-auth.mjs <encrypted-backup>')
}
if (process.env.AUTH_RESTORE_CONFIRM !== 'replace') {
  throw new Error('Set AUTH_RESTORE_CONFIRM=replace after stopping the viewer')
}

const encryptedPath = resolve(encryptedPathArgument)
const databasePath = resolve(process.env.AUTH_DB_PATH ?? '.data/auth.sqlite')
const key = Buffer.from(process.env.AUTH_BACKUP_KEY ?? '', 'base64')
if (key.length !== 32) {
  throw new Error('AUTH_BACKUP_KEY must be a base64-encoded 32-byte key')
}

const payload = readFileSync(encryptedPath)
if (payload.subarray(0, 8).toString() !== 'MTXAUTH1') {
  throw new Error('The backup has an unknown format')
}
const iv = payload.subarray(8, 20)
const tag = payload.subarray(20, 36)
const decipher = createDecipheriv('aes-256-gcm', key, iv)
decipher.setAuthTag(tag)
const plaintext = Buffer.concat([
  decipher.update(payload.subarray(36)),
  decipher.final(),
])

mkdirSync(dirname(databasePath), { recursive: true })
const temporaryPath = `${databasePath}.restore-tmp`
writeFileSync(temporaryPath, plaintext, { mode: 0o600 })
const restored = new Database(temporaryPath, { readonly: true })
const integrity = restored.pragma('integrity_check')
restored.close()
if (!Array.isArray(integrity) || integrity[0]?.integrity_check !== 'ok') {
  throw new Error('The decrypted database failed SQLite integrity_check')
}

const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
for (const suffix of ['', '-wal', '-shm']) {
  const current = `${databasePath}${suffix}`
  if (existsSync(current)) renameSync(current, `${databasePath}.pre-restore-${stamp}${suffix}`)
}
renameSync(temporaryPath, databasePath)
process.stdout.write(`Restored ${databasePath}; the previous files were retained beside it.\n`)

