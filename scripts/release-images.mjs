import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { sourceFingerprint } from './chat-capacity/source.mjs'

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }).trim()
const inspect = image => JSON.parse(docker('image', 'inspect', image))[0]

async function smokeViewer(reference, version) {
  const name = `release-viewer-${randomUUID()}`
  try {
    docker('run', '-d', '--name', name, '-p', '127.0.0.1::3000',
      '-e', 'AUTH_DB_PATH=/tmp/auth.sqlite', '-e', 'CHAT_DB_PATH=/tmp/chat.sqlite', '-e', 'CHAT_ENABLED=false',
      '-e', 'BETTER_AUTH_URL=http://localhost:3000',
      ...['BETTER_AUTH_SECRET', 'INTERNAL_AUTH_SECRET', 'MEDIAMTX_AUTH_SECRET'].flatMap(key => ['-e', `${key}=${randomBytes(32).toString('hex')}`]), reference)
    const port = JSON.parse(docker('inspect', name))[0].NetworkSettings.Ports['3000/tcp'][0].HostPort
    for (let attempt = 0; attempt < 90; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) })
        const health = await response.json()
        if (response.ok && health.status === 'ok' && health.version === version && health.chat?.status === 'disabled') return
      } catch { /* Wait for application startup. */ }
      if (!JSON.parse(docker('inspect', name))[0].State.Running) break
      await delay(500)
    }
    throw new Error('Viewer image did not reach the expected version and health')
  } finally {
    try { docker('rm', '-f', name) } catch { /* No container if startup failed. */ }
  }
}

async function smokeThumbnailer(reference) {
  docker('run', '--rm', '--network', 'none', '--entrypoint', 'ffmpeg', reference, '-version')
  const name = `release-thumbnailer-${randomUUID()}`
  try {
    docker('run', '-d', '--network', 'none', '--name', name, reference)
    await delay(1500)
    if (!JSON.parse(docker('inspect', name))[0].State.Running) throw new Error('Thumbnailer image exited during startup')
  } finally {
    try { docker('rm', '-f', name) } catch { /* No container if startup failed. */ }
  }
}

// Inspect every layer, including files removed by later layers.
function inspectLayers(reference, canary) {
  const directory = mkdtempSync(join(tmpdir(), 'release-layers-'))
  try {
    const archive = join(directory, 'image.tar')
    docker('image', 'save', '-o', archive, reference)
    const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'manifest.json'], { encoding: 'utf8' }))
    for (const layer of manifest[0].Layers) {
      const bytes = execFileSync('tar', ['-xOf', archive, layer], { maxBuffer: 512 * 1024 * 1024 })
      if (canary && bytes.includes(Buffer.from(canary))) throw new Error('Private build-context canary entered an image layer')
      const paths = execFileSync('tar', ['-tf', '-'], { input: bytes, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      if (paths.split('\n').some(path => /^(?:\.\/)?app\/(?:deploy\/oracle\/(?:secrets|secrets\.enc|terraform)(?:\/|$)|\.data(?:\/|$)|\.scratch(?:\/|$)|\.env(?:\.|$)|credentials\.txt$)/.test(path))) {
        throw new Error('Private deployment files entered an image layer')
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export async function verifyImages(references, identity, { anonymous = false, canary } = {}) {
  const temporaryConfig = mkdtempSync(join(tmpdir(), 'release-docker-'))
  try {
    const evidence = {}
    for (const name of ['viewer', 'thumbnailer']) {
      const reference = references[name]
      if (anonymous) {
        try { docker('--config', temporaryConfig, 'pull', reference) }
        catch { throw new Error(`Anonymous pull failed for ${name}. Set the GitHub package visibility to public and rerun verification.`) }
      }
      const image = inspect(reference)
      const labels = image.Config.Labels ?? {}
      if (image.Os !== 'linux' || image.Architecture !== 'arm64' || labels['org.opencontainers.image.revision'] !== identity.commit || labels['org.frankerzspam.source'] !== identity.sourceFingerprint) {
        throw new Error(`Wrong architecture or source identity for ${name}`)
      }
      inspectLayers(reference, canary)
      if (name === 'viewer') await smokeViewer(reference, identity.version)
      else await smokeThumbnailer(reference)
      evidence[name] = { reference, os: image.Os, architecture: image.Architecture, revision: identity.commit, sourceFingerprint: identity.sourceFingerprint, smokePassed: true }
    }
    return evidence
  } finally {
    rmSync(temporaryConfig, { recursive: true, force: true })
  }
}

export function buildImages(repository, suffix, identity) {
  const canary = randomBytes(32).toString('hex')
  const privatePaths = ['.env.release-canary', 'credentials.txt', 'deploy/oracle/secrets.enc/release-canary.enc']
  const created = []
  const references = {}
  try {
    mkdirSync('deploy/oracle/secrets.enc', { recursive: true })
    for (const path of privatePaths) {
      writeFileSync(path, canary, { mode: 0o600, flag: 'wx' })
      created.push(path)
    }
    for (const name of ['viewer', 'thumbnailer']) {
      const reference = `${repository}/${name}:${suffix}`
      execFileSync('docker', ['build', '--platform', 'linux/arm64', '-t', reference,
        '--build-arg', `SOURCE_FINGERPRINT=${identity.sourceFingerprint}`, '--build-arg', `SOURCE_REVISION=${identity.commit}`,
        '--build-arg', `SOURCE_REPOSITORY=${identity.repositoryUrl}`,
        '--build-arg', 'MEDIAMTX_HLS_URL=http://mediamtx:8888', '--build-arg', 'MEDIAMTX_WEBRTC_URL=http://mediamtx:8889',
        '-f', name === 'viewer' ? 'Dockerfile' : 'deploy/oracle/thumbnailer.Dockerfile', '.'], { stdio: 'inherit' })
      references[name] = reference
    }
    return { references, canary }
  } finally {
    for (const path of created) rmSync(path, { force: true })
  }
}

export function pushImages(references) {
  return Object.fromEntries(Object.entries(references).map(([name, reference]) => {
    execFileSync('docker', ['push', reference], { stdio: 'inherit' })
    const repository = reference.slice(0, reference.lastIndexOf(':'))
    const digest = inspect(reference).RepoDigests.find(value => value.startsWith(`${repository}@sha256:`))
    if (!digest) throw new Error(`Missing published digest for ${name}`)
    return [name, digest]
  }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const identity = {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      version: JSON.parse(readFileSync('package.json', 'utf8')).version,
      sourceFingerprint: sourceFingerprint(),
      repositoryUrl: 'https://github.com/tprjd/mediamtx-viewer',
    }
    const { references, canary } = buildImages('mediamtx-release-test', `local-${randomUUID()}`, identity)
    console.log(JSON.stringify(await verifyImages(references, identity, { canary }), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
