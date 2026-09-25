// Runs in the private host tool container. Never starts the application.
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function treeDigest(path) {
  const hash = createHash('sha256')
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const file = join(directory, name), stat = lstatSync(file)
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('Unsupported managed file')
      hash.update(JSON.stringify([file.slice(path.length), stat.mode, stat.uid, stat.gid]))
      if (stat.isDirectory()) visit(file)
      else hash.update(readFileSync(file))
    }
  }
  visit(path)
  return hash.digest('hex')
}
export function runtimeIdentity(container) {
  return { image: container.Image, config: container.Config, host: container.HostConfig,
    mounts: container.Mounts.map(({ Type, Name, Source, Destination, RW }) => ({ Type, Name, Source, Destination, RW })).sort((a, b) => a.Destination.localeCompare(b.Destination)) }
}
export function saveDeploymentState(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(`${path}.next`, JSON.stringify(value), { mode: 0o600, flush: true })
  renameSync(`${path}.next`, path)
  const fd = openSync(dirname(path), 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [action, json] = process.argv.slice(2), input = JSON.parse(json.startsWith('@') ? readFileSync(json.slice(1), 'utf8') : json)
    let result = {}
    if (action === 'exists') result = { exists: existsSync(input.path) }
    else if (action === 'read') result = JSON.parse(readFileSync(input.path, 'utf8'))
    else if (action === 'save') saveDeploymentState(input.path, input.value)
    else if (action === 'chat-lock') {
      const { acquireBackupOperation } = await import('./backup-operation.mjs')
      const lock = join(input.directory, '.backup-lock')
      if (input.resume && existsSync(lock)) {
        if (existsSync(join(dirname(input.authPath), '.maintenance-backup.json')) ||
            JSON.parse(readFileSync(join(lock, 'chat-owner.json'), 'utf8')).attempt !== input.attempt) throw new Error('Chat lock owner differs')
      } else {
        const release = acquireBackupOperation(input.directory, input.authPath)
        try { saveDeploymentState(join(lock, 'chat-owner.json'), { attempt: input.attempt }) }
        catch (error) { release(); throw error }
      }
    } else if (action === 'chat-unlock') {
      const lock = join(input.directory, '.backup-lock')
      if (existsSync(lock)) {
        if (JSON.parse(readFileSync(join(lock, 'chat-owner.json'), 'utf8')).attempt !== input.attempt) throw new Error('Chat lock owner differs')
        rmSync(lock, { recursive: true })
      }
    }
    else if (action === 'ownership') {
      const entries = {}
      function visit(path) {
        const stat = lstatSync(path)
        entries[path] = { uid: stat.uid, gid: stat.gid, mode: stat.mode }
        if (stat.isDirectory()) for (const name of readdirSync(path)) visit(join(path, name))
      }
      for (const path of input.paths) visit(path)
      saveDeploymentState(input.destination, { roots: input.paths, entries })
    } else if (action === 'check-ownership') {
      const { roots, entries } = JSON.parse(readFileSync(input.path, 'utf8'))
      for (const [path, expected] of Object.entries(entries)) {
        if (!existsSync(path) && !roots.includes(path)) continue
        const stat = lstatSync(path)
        if (stat.uid !== expected.uid || stat.gid !== expected.gid || stat.mode !== expected.mode) throw new Error('Persistent volume ownership changed')
      }
    }
    else if (action === 'migration-names') result = Object.fromEntries([['auth', 'migrations'], ['chat', 'chat-migrations']].map(([name, folder]) => [name, readdirSync(join(input.path, folder)).filter(file => file.endsWith('.sql')).sort()]))
    else if (action === 'tree') result = { digest: treeDigest(input.path) }
    else throw new Error('Unknown deployment state action')
    console.log(JSON.stringify(result))
  } catch { console.error('Managed deployment state is unavailable'); process.exitCode = 1 }
}
