import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const built = new Map()
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// Reuse only immutable image inputs. Each scenario still creates its own image
// labels, containers, volumes, networks, keys, and databases.
export function stagingImage(directory, endpoint, image, commit, fingerprint) {
  const recipe = readFileSync('scripts/fixtures/maintenance/Dockerfile', 'utf8') + '\nRUN cp scripts/fixtures/maintenance/server.mjs server.js && chown 1001:1001 /data\nUSER 1001\n'
  const hash = createHash('sha256').update(recipe)
  const files = ['package.json', 'package-lock.json', '.dockerignore',
    ...['scripts', 'migrations', 'chat-migrations'].flatMap(root => readdirSync(root, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)))].sort()
  for (const file of files) hash.update(file).update('\0').update(readFileSync(file)).update('\0')
  const key = `${endpoint}:${hash.digest('hex')}`
  const base = `mediamtx-test-base:${key.split(':').at(-1)}`
  if (!built.has(key)) {
    writeFileSync(join(directory, 'base.Dockerfile'), recipe)
    docker('build', '-q', '-t', base, '-f', join(directory, 'base.Dockerfile'), '.')
    built.set(key, true)
  }
  writeFileSync(join(directory, 'labels.Dockerfile'), `FROM ${base}\nLABEL org.opencontainers.image.revision="${commit}" org.frankerzspam.source="${fingerprint}"\n`)
  docker('build', '-q', '-t', image, '-f', join(directory, 'labels.Dockerfile'), directory)
}
