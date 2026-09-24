import Database from 'better-sqlite3'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { acquireBackupOperation } from './backup-operation.mjs'
import { purgeExpiredChat } from './chat-retention.mjs'

const setPattern = /^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]{36}$/

export function backupKey() {
  const key = Buffer.from(process.env.AUTH_BACKUP_KEY ?? '', 'base64')
  if (key.length !== 32)
    throw new Error('AUTH_BACKUP_KEY must be a base64-encoded 32-byte key')
  return key
}

function sign(manifest, key) {
  return createHmac('sha256', key)
    .update(JSON.stringify(manifest))
    .digest('hex')
}

async function digest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function schema(database) {
  return database
    .prepare('SELECT name FROM app_migration ORDER BY name')
    .all()
    .map((row) => row.name)
}

export function validateDatabase(database, migrations) {
  if (
    database.pragma('integrity_check', { simple: true }) !== 'ok' ||
    database.pragma('foreign_key_check').length
  ) {
    throw new Error('Database integrity check failed')
  }
  if (JSON.stringify(schema(database)) !== JSON.stringify(migrations))
    throw new Error('Database schema does not match the backup')
}

export async function readBackupManifest(manifestPath, key) {
  const { signature, ...manifest } = JSON.parse(
    readFileSync(manifestPath, 'utf8'),
  )
  const expected = Buffer.from(sign(manifest, key), 'hex')
  const received = Buffer.from(
    typeof signature === 'string' ? signature : '',
    'hex',
  )
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    throw new Error('Invalid backup manifest signature')
  if (
    manifest.version !== 1 ||
    !setPattern.test(manifest.id) ||
    !Number.isFinite(Date.parse(manifest.createdAt))
  )
    throw new Error('Invalid backup manifest')
  for (const name of ['auth', 'chat']) {
    const entry = manifest.databases?.[name]
    if (
      entry?.file !== `${name}.sqlite.enc` ||
      !Array.isArray(entry.migrations)
    )
      throw new Error('Incomplete backup set')
    const path = join(dirname(manifestPath), entry.file)
    if (
      statSync(path).size !== entry.bytes ||
      (await digest(path)) !== entry.sha256
    )
      throw new Error('Backup checksum mismatch')
  }
  return manifest
}

export async function decryptDatabaseBackup(
  manifestPath,
  name,
  destination,
  key = backupKey(),
) {
  if (!['auth', 'chat'].includes(name)) throw new Error('Select auth or chat')
  const manifest = await readBackupManifest(manifestPath, key)
  const entry = manifest.databases[name]
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(entry.iv, 'base64'),
  )
  decipher.setAAD(Buffer.from(`${manifest.id}:${name}`))
  decipher.setAuthTag(Buffer.from(entry.tag, 'base64'))
  const descriptor = openSync(destination, 'wx', 0o600)
  closeSync(descriptor)
  try {
    await pipeline(
      createReadStream(join(dirname(manifestPath), entry.file)),
      decipher,
      createWriteStream(destination, { flags: 'w', mode: 0o600 }),
    )
    const db = new Database(destination, { readonly: true })
    try {
      validateDatabase(db, entry.migrations)
    } finally {
      db.close()
    }
  } catch (error) {
    rmSync(destination, { force: true })
    throw error
  }
  return manifest
}

export async function createBackupSet({
  authPath,
  chatPath,
  directory,
  key = backupKey(),
  now = new Date(),
  deployment = false,
}) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const release = acquireBackupOperation(directory, authPath)
  const id = `${now.toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${randomUUID()}`
  const staging = join(directory, `.pending-${id}`)
  try {
    // Only this job owns pending and retired directories while it holds the lock.
    for (const name of readdirSync(directory)) {
      if (name.startsWith('.pending-') || name.startsWith('.retired-'))
        rmSync(join(directory, name), { recursive: true, force: true })
    }
    if (existsSync(`${chatPath}.maintenance`))
      throw new Error('Chat restore is in progress')
    mkdirSync(staging, { mode: 0o700 })
    const manifest = {
      version: 1,
      id,
      createdAt: now.toISOString(),
      encryption: 'AES-256-GCM',
      databases: {},
    }
    for (const [name, path] of [
      ['auth', authPath],
      ['chat', chatPath],
    ]) {
      const snapshot = join(staging, `${name}.sqlite`)
      const db = new Database(path, { fileMustExist: true })
      try {
        db.pragma('foreign_keys = ON')
        db.pragma('busy_timeout = 5000')
        if (name === 'chat' && !deployment) purgeExpiredChat(db, now.getTime())
        await db.backup(snapshot)
      } finally {
        db.close()
      }
      const copy = new Database(snapshot)
      let migrations
      try {
        copy.pragma('foreign_keys = ON')
        // A concurrent writer cannot put expired content into the completed snapshot.
        if (name === 'chat') purgeExpiredChat(copy, now.getTime())
        copy.exec('VACUUM')
        migrations = schema(copy)
        validateDatabase(copy, migrations)
      } finally {
        copy.close()
      }
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(Buffer.from(`${id}:${name}`))
      const file = `${name}.sqlite.enc`
      const encryptedPath = join(staging, file)
      await pipeline(
        createReadStream(snapshot),
        cipher,
        createWriteStream(encryptedPath, { mode: 0o600 }),
      )
      manifest.databases[name] = {
        file,
        bytes: statSync(encryptedPath).size,
        sha256: await digest(encryptedPath),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        migrations,
      }
      for (const suffix of ['', '-wal', '-shm'])
        rmSync(`${snapshot}${suffix}`, { force: true })
    }
    if (existsSync(`${chatPath}.maintenance`))
      throw new Error('Chat restore is in progress')
    writeFileSync(
      join(staging, 'manifest.json'),
      JSON.stringify({ ...manifest, signature: sign(manifest, key) }, null, 2) +
        '\n',
      { mode: 0o600 },
    )
    const completed = join(directory, id)
    renameSync(staging, completed)
    if (deployment) return join(completed, 'manifest.json')
    const complete = []
    for (const name of readdirSync(directory)
      .filter((name) => setPattern.test(name))
      .sort()
      .reverse()) {
      try {
        await readBackupManifest(join(directory, name, 'manifest.json'), key)
        complete.push(name)
      } catch {
        const required = ['manifest.json', 'auth.sqlite.enc', 'chat.sqlite.enc']
        if (required.some((file) => !existsSync(join(directory, name, file))))
          retireSet(directory, name)
        // Preserve complete but unreadable or unauthenticated sets for the operator.
      }
    }
    // Keep the newest complete set for each of seven days.
    const days = new Set()
    for (const name of complete) {
      const day = name.slice(0, 10)
      if (days.has(day) || days.size >= 7) retireSet(directory, name)
      else days.add(day)
    }
    return join(completed, 'manifest.json')
  } finally {
    rmSync(staging, { recursive: true, force: true })
    release()
  }
}

function retireSet(directory, name) {
  const retired = join(directory, `.retired-${name}`)
  renameSync(join(directory, name), retired)
  rmSync(retired, { recursive: true, force: true })
}

export function backupPaths() {
  return {
    authPath: resolve(process.env.AUTH_DB_PATH ?? '.data/auth.sqlite'),
    chatPath: resolve(process.env.CHAT_DB_PATH ?? '.data/chat.sqlite'),
    directory: resolve(process.env.AUTH_BACKUP_DIR ?? '.data/backups'),
  }
}
