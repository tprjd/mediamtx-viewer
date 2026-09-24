// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const directories = []
const command = resolve('scripts/release.mjs')

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'release-test-'))
  directories.push(directory)
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init')
  git('config', 'user.email', 'release@example.test')
  git('config', 'user.name', 'Release fixture')
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: '1.2.3' }))
  writeFileSync(join(directory, '.gitignore'), '.data\n')
  git('add', '.')
  git('commit', '-m', 'fixture')
  git('tag', '-a', 'v1.2.3', '-m', 'Release v1.2.3')
  return { directory, git }
}

it('identifies the committed source of an annotated release tag', () => {
  const { directory, git } = repository()
  const result = spawnSync(process.execPath, [command, 'identify', 'v1.2.3'], { cwd: directory, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toMatchObject({ tag: 'v1.2.3', version: '1.2.3', commit: git('rev-parse', 'HEAD'), tagObject: git('rev-parse', 'v1.2.3') })
})

it.each(['lightweight', 'version', 'dirty', 'different-commit'])('rejects a %s release checkout', failure => {
  const { directory, git } = repository()
  let tag = 'v1.2.3'
  if (failure === 'lightweight') { git('tag', '-d', tag); git('tag', tag) }
  if (failure === 'version') { tag = 'v2.0.0'; git('tag', '-a', tag, '-m', 'wrong version') }
  if (failure === 'dirty') writeFileSync(join(directory, 'package.json'), '{"version":"1.2.4"}')
  if (failure === 'different-commit') git('commit', '--allow-empty', '-m', 'later commit')
  const result = spawnSync(process.execPath, [command, 'identify', tag], { cwd: directory, encoding: 'utf8' })
  expect(result.status).not.toBe(0)
})

function evidenceFixture() {
  const fixture = repository()
  const { directory } = fixture
  mkdirSync(join(directory, '.data'))
  const run = (...args) => spawnSync(process.execPath, [command, ...args], { cwd: directory, encoding: 'utf8', env: { ...process.env, GITHUB_REPOSITORY: 'owner/viewer', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' } })
  const fingerprint = run('fingerprint').stdout.trim()
  const checks = { version: 1, passed: true, sourceFingerprint: fingerprint, finishedAt: new Date().toISOString(), checks: ['lint', 'type', 'test', 'browser', 'restore', 'build', 'streaming-contract', 'deployment'].map(name => ({ name, passed: true })) }
  const images = Object.fromEntries(['viewer', 'thumbnailer'].map((name, index) => [name, { reference: `ghcr.io/owner/viewer/${name}@sha256:${String(index + 1).repeat(64)}`, os: 'linux', architecture: 'arm64', revision: fixture.git('rev-parse', 'HEAD'), sourceFingerprint: fingerprint, smokePassed: true }]))
  const write = (name, value) => writeFileSync(join(directory, '.data', name), JSON.stringify(value))
  write('checks.json', checks)
  write('images.json', images)
  return { ...fixture, run, checks, images, write }
}

it('creates a release record only after complete evidence and never replaces an existing record', () => {
  const { directory, run } = evidenceFixture()
  const args = ['record', 'v1.2.3', '.data/checks.json', '.data/images.json', '.data/release.json']
  const result = run(...args)
  expect(result.status, result.stderr).toBe(0)
  const record = JSON.parse(readFileSync(join(directory, '.data/release.json'), 'utf8'))
  expect(record).toMatchObject({ format: 1, tag: 'v1.2.3', version: '1.2.3', repository: 'owner/viewer', images: { viewer: `ghcr.io/owner/viewer/viewer@sha256:${'1'.repeat(64)}` } })
  expect(run(...args).status).not.toBe(0)
})

it.each(['missing-check', 'failed-check', 'stale', 'future', 'source', 'architecture', 'digest', 'revision', 'smoke'])('rejects %s evidence before creating a release record', failure => {
  const { directory, run, checks, images, write } = evidenceFixture()
  if (failure === 'missing-check') checks.checks.pop()
  if (failure === 'failed-check') checks.checks[0].passed = false
  if (failure === 'stale') checks.finishedAt = '2000-01-01T00:00:00.000Z'
  if (failure === 'future') checks.finishedAt = '2100-01-01T00:00:00.000Z'
  if (failure === 'source') checks.sourceFingerprint = 'a'.repeat(64)
  if (failure === 'architecture') images.viewer.architecture = 'amd64'
  if (failure === 'digest') images.viewer.reference = 'ghcr.io/owner/viewer/viewer:latest'
  if (failure === 'revision') images.thumbnailer.revision = 'b'.repeat(40)
  if (failure === 'smoke') images.viewer.smokePassed = false
  write('checks.json', checks)
  write('images.json', images)
  const result = run('record', 'v1.2.3', '.data/checks.json', '.data/images.json', '.data/release.json')
  expect(result.status, result.stdout).not.toBe(0)
  expect(() => readFileSync(join(directory, '.data/release.json'))).toThrow()
})

it('refreshes verification for the same images without changing the published record', () => {
  const { directory, run, checks, images, write } = evidenceFixture()
  expect(run('record', 'v1.2.3', '.data/checks.json', '.data/images.json', '.data/release.json').status).toBe(0)
  const original = readFileSync(join(directory, '.data/release.json'), 'utf8')
  checks.finishedAt = new Date().toISOString()
  write('checks.json', checks)
  const refreshed = run('refresh', '.data/release.json', '.data/checks.json', '.data/images.json', '.data/refreshed.json')
  expect(refreshed.status, refreshed.stderr).toBe(0)
  expect(readFileSync(join(directory, '.data/release.json'), 'utf8')).toBe(original)
  const result = JSON.parse(readFileSync(join(directory, '.data/refreshed.json'), 'utf8'))
  expect(result.images).toEqual(JSON.parse(original).images)
  images.viewer.reference = `ghcr.io/owner/viewer/viewer@sha256:${'9'.repeat(64)}`
  write('images.json', images)
  expect(run('refresh', '.data/release.json', '.data/checks.json', '.data/images.json', '.data/invalid.json').status).not.toBe(0)
})

it('fingerprints the thumbnailer and deployment inputs without reading secret bundles', () => {
  const { directory } = repository()
  const folder = join(directory, 'deploy/oracle')
  mkdirSync(join(folder, 'secrets.enc'), { recursive: true })
  const fingerprint = () => {
    const result = spawnSync(process.execPath, [command, 'fingerprint'], { cwd: directory, encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    return result.stdout.trim()
  }
  writeFileSync(join(folder, 'thumbnailer.Dockerfile'), 'FROM node:24-alpine\n')
  const before = fingerprint()
  writeFileSync(join(folder, 'secrets.enc/private.enc'), 'not a build input')
  expect(fingerprint()).toBe(before)
  writeFileSync(join(folder, 'thumbnailer.Dockerfile'), 'FROM node:24-alpine\nRUN echo changed\n')
  expect(fingerprint()).not.toBe(before)
})
