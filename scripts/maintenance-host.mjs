// Runs only as an explicit tool command, never through application startup.
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, createReadStream, copyFileSync, fsyncSync, openSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { backupKey, backupPaths, createBackupSet, validateDatabase } from './database-backups.mjs'
import { acquireBackupOperation } from './backup-operation.mjs'
import { requireSpace } from './backup-verification.mjs'

const paths = backupPaths()
const root = dirname(paths.authPath)
const marker = join(root, '.maintenance-backup.json')
const lock = join(paths.directory, '.backup-lock')
const [command, argument] = process.argv.slice(2)
const read = () => JSON.parse(readFileSync(marker, 'utf8'))
function save(state) {
  writeFileSync(`${marker}.next`, `${JSON.stringify(state)}\n`, { mode: 0o600, flush: true })
  renameSync(`${marker}.next`, marker)
  const descriptor = openSync(root, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}
async function fingerprints() {
  const result = {}
  for (const [name, path] of [['auth', paths.authPath], ['chat', paths.chatPath]]) {
    for (const suffix of ['', '-wal']) {
      if (!existsSync(path + suffix)) { result[name + suffix] = null; continue }
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path + suffix)) hash.update(chunk)
      result[name + suffix] = hash.digest('hex')
    }
  }
  return result
}
function measurement() {
  let bytes = 0
  const migrations = {}
  for (const [name, path] of [['auth', paths.authPath], ['chat', paths.chatPath]]) {
    const db = new Database(path, { readonly: true, fileMustExist: true })
    try {
      migrations[name] = db.prepare('SELECT name FROM app_migration ORDER BY name').all().map(row => row.name)
      validateDatabase(db, migrations[name])
      bytes += db.pragma('page_count', { simple: true }) * db.pragma('page_size', { simple: true })
    } finally { db.close() }
    for (const suffix of ['', '-wal']) if (existsSync(path + suffix)) bytes += statSync(path + suffix).size
  }
  // Raw copies, SQLite backup, VACUUM journal, encrypted copies, and growth margin.
  const requiredBytes = bytes * 6 + 64 * 1024 * 1024
  requireSpace(root, requiredBytes)
  mkdirSync(join(root, 'deployment-backups'), { recursive: true, mode: 0o700 })
  requireSpace(join(root, 'deployment-backups'), requiredBytes)
  return { requiredBytes, migrations }
}
try {
  let result = {}
  if (command === 'preflight') {
    backupKey()
    if (existsSync(marker) || existsSync(lock) || existsSync(`${paths.chatPath}.maintenance`) || existsSync(`${paths.chatPath}.restore-lock`)) throw new Error('Operation in progress')
    result = measurement()
  } else if (command === 'begin') {
    backupKey()
    const release = acquireBackupOperation(paths.directory, paths.authPath)
    try {
      if (existsSync(`${paths.chatPath}.maintenance`) || existsSync(`${paths.chatPath}.restore-lock`)) throw new Error('Chat restore in progress')
      result = measurement()
      save({ ...JSON.parse(argument), phase: 'prepared', measurement: result })
    } catch (error) { release(); throw error }
  } else if (command === 'state') {
    result = read()
  } else if (command === 'phase') {
    const state = read()
    save({ ...state, ...JSON.parse(argument) })
  } else if (command === 'snapshot') {
    const state = read()
    const frozen = await fingerprints()
    const work = join(root, `.maintenance-plaintext-${state.attempt}`)
    save({ ...state, phase: 'snapshot', frozen })
    let rawBytes = 0
    for (const path of [paths.authPath, paths.chatPath]) {
      for (const suffix of ['', '-wal']) if (existsSync(path + suffix)) rawBytes += statSync(path + suffix).size
    }
    requireSpace(root, rawBytes * 6 + 64 * 1024 * 1024)
    mkdirSync(work, { mode: 0o700 })
    try {
      // All writers are frozen. Copy WAL with the database, then let SQLite recover
      // the private copy. Never open a frozen live WAL through SQLite's shared locks.
      for (const [name, path] of [['auth', paths.authPath], ['chat', paths.chatPath]]) {
        for (const suffix of ['', '-wal']) if (existsSync(path + suffix)) {
          const destination = join(work, `${name}.sqlite${suffix}`)
          copyFileSync(path + suffix, destination)
          chmodSync(destination, 0o600)
        }
      }
      const manifest = await createBackupSet({ authPath: join(work, 'auth.sqlite'), chatPath: join(work, 'chat.sqlite'),
        directory: join(root, 'deployment-backups'), deployment: true })
      result = { ...read(), hostManifest: manifest, backupId: JSON.parse(readFileSync(manifest, 'utf8')).id, phase: 'copied-on-host' }
      save(result)
    } finally { rmSync(work, { recursive: true, force: true }) }
  } else if (command === 'claim-resume') {
    if (read().phase !== 'held') throw new Error('No held backup')
    mkdirSync(join(root, '.maintenance-resume-lock'), { mode: 0o700 })
  } else if (command === 'release-resume') {
    rmSync(join(root, '.maintenance-resume-lock'), { recursive: true, force: true })
  } else if (command === 'unchanged') {
    const state = read()
    if (!state.frozen && state.phase !== 'entering-maintenance') throw new Error('Unknown database state')
    if (state.frozen && JSON.stringify(state.frozen) !== JSON.stringify(await fingerprints())) throw new Error('Database state changed')
  } else if (command === 'finish') {
    const attempt = argument ? JSON.parse(argument).attempt : read().attempt
    const completed = join(root, `.maintenance-completed-${attempt}.json`)
    if (existsSync(marker)) {
      if (read().attempt !== attempt) throw new Error('Maintenance owner differs')
      writeFileSync(completed, JSON.stringify({ attempt }), { mode: 0o600, flush: true })
      const completionDirectory = openSync(root, 'r')
      try { fsyncSync(completionDirectory) } finally { closeSync(completionDirectory) }
      // Keep the marker until the old lock is gone. New scheduled work still
      // refuses this marker, even if it acquires the just-released lock.
      rmSync(lock, { recursive: true, force: true })
      const lockDirectory = openSync(paths.directory, 'r')
      try { fsyncSync(lockDirectory) } finally { closeSync(lockDirectory) }
      rmSync(marker)
      const markerDirectory = openSync(root, 'r')
      try { fsyncSync(markerDirectory) } finally { closeSync(markerDirectory) }
    } else if (!existsSync(completed)) throw new Error('Maintenance completion is unknown')
  } else if (command === 'cancel-preflight') {
    if (read().phase !== 'prepared') throw new Error('Maintenance already started')
    rmSync(marker)
    rmSync(lock, { recursive: true })
  } else throw new Error('Unknown maintenance command')
  process.stdout.write(`${JSON.stringify(result)}\n`)
} catch {
  console.error('Maintenance host check failed')
  process.exitCode = 1
}
