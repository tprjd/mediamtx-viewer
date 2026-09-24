import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { sourceFingerprint } from './chat-capacity/source.mjs'
import { requiredChecks } from './verification-checks.mjs'

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export function identifyRelease(tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error('Select a vX.Y.Z release tag')
  if (git('cat-file', '-t', `refs/tags/${tag}`) !== 'tag') throw new Error('Release tag must be annotated')
  const commit = git('rev-parse', `refs/tags/${tag}^{commit}`)
  if (commit !== git('rev-parse', 'HEAD')) throw new Error('Check out the selected release before verification')
  if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('Release checkout must be clean')
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  if (`v${version}` !== tag) throw new Error('Release tag does not match the application version')
  return { tag, version, commit, tagObject: git('rev-parse', `refs/tags/${tag}`) }
}

const readJSON = path => JSON.parse(readFileSync(path, 'utf8'))

export function validateChecks(checks, fingerprint, now = Date.now()) {
  const age = now - Date.parse(checks.finishedAt)
  if (checks.version !== 1 || checks.passed !== true || !Number.isFinite(age) || age < 0 || age > 86_400_000 ||
      checks.sourceFingerprint !== fingerprint ||
      requiredChecks.some(name => !checks.checks?.some(check => check.name === name && check.passed === true)) ||
      checks.checks.some(check => check.passed !== true)) throw new Error('Incomplete, stale, or mismatched verification')
}

function imageReference(reference, repository, name) {
  const prefix = `ghcr.io/${repository}/${name}@sha256:`
  return typeof reference === 'string' && reference.startsWith(prefix) && /^[a-f0-9]{64}$/.test(reference.slice(prefix.length))
}

export function createReleaseRecord(tag, checks, images) {
  const identity = identifyRelease(tag)
  const repository = process.env.GITHUB_REPOSITORY?.toLowerCase()
  const fingerprint = sourceFingerprint()
  if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/.test(repository ?? '')) throw new Error('Missing GitHub repository identity')
  validateChecks(checks, fingerprint)
  for (const name of ['viewer', 'thumbnailer']) {
    const image = images[name]
    if (!image || !imageReference(image.reference, repository, name) || image.os !== 'linux' || image.architecture !== 'arm64' ||
        image.revision !== identity.commit || image.sourceFingerprint !== fingerprint || image.smokePassed !== true) {
      throw new Error(`Unverified ${name} image`)
    }
  }
  return {
    format: 1,
    ...identity,
    repository,
    sourceFingerprint: fingerprint,
    images: Object.fromEntries(['viewer', 'thumbnailer'].map(name => [name, images[name].reference])),
    verification: { ...checks, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT },
  }
}

export function refreshReleaseRecord(previous, checks, images) {
  const next = createReleaseRecord(previous.tag, checks, images)
  for (const key of ['format', 'tag', 'version', 'repository', 'commit', 'tagObject', 'sourceFingerprint']) {
    if (previous[key] !== next[key]) throw new Error('Published release identity changed')
  }
  for (const name of ['viewer', 'thumbnailer']) {
    if (previous.images?.[name] !== next.images[name]) throw new Error('Published image digest changed')
  }
  return next
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [action, tag, checksPath, imagesPath, output] = process.argv.slice(2)
    if (action === 'identify') console.log(JSON.stringify(identifyRelease(tag)))
    else if (action === 'fingerprint') console.log(sourceFingerprint())
    else if (action === 'record') {
      const record = createReleaseRecord(tag, readJSON(checksPath), readJSON(imagesPath))
      writeFileSync(output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
      console.log(output)
    }
    else if (action === 'refresh') {
      const record = refreshReleaseRecord(readJSON(tag), readJSON(checksPath), readJSON(imagesPath))
      writeFileSync(output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
      console.log(output)
    }
    else throw new Error('Usage: release.mjs identify TAG | fingerprint | record TAG CHECKS IMAGES OUTPUT | refresh RECORD CHECKS IMAGES OUTPUT')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
