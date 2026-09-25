// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createBackupSet } from './database-backups.mjs'

const key = Buffer.alloc(32, 9).toString('base64')
function command(action, input, encryptionKey = key) {
  const result = spawnSync(process.execPath, ['scripts/deployment-retention.mjs', action, JSON.stringify(input)],
    { encoding: 'utf8', env: { ...process.env, AUTH_BACKUP_KEY: encryptionKey } })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}
it('keeps the two newest whole verified sets from the same day and leaves daily backups alone', async () => {
  const root = mkdtempSync(join(tmpdir(), 'retention-'))
  try {
    const authPath = join(root, 'auth.sqlite'), chatPath = join(root, 'chat.sqlite')
    for (const script of ['migrate.mjs', 'migrate-chat.mjs']) {
      const result = spawnSync(process.execPath, [`scripts/${script}`], { env: { ...process.env, AUTH_DB_PATH: authPath, CHAT_DB_PATH: chatPath } })
      expect(result.status).toBe(0)
    }
    const directory = join(root, 'deployment-backups'), manifests = []
    for (let n = 0; n < 3; n++) manifests.push(await createBackupSet({ authPath, chatPath, directory, key: Buffer.from(key, 'base64'), deployment: true, now: new Date(`2026-09-25T10:00:0${n}Z`) }))
    const daily = join(root, 'backups', 'daily-marker')
    mkdirSync(join(root, 'backups')); writeFileSync(daily, 'keep')
    const dailyDirectory = join(root, 'backups')
    for (let day = 1; day <= 7; day++) await createBackupSet({ authPath, chatPath, directory: dailyDirectory, key: Buffer.from(key, 'base64'), now: new Date(`2026-09-0${day}T10:00:00Z`) })
    const rotating = createBackupSet({ authPath, chatPath, directory: dailyDirectory, key: Buffer.from(key, 'base64'), now: new Date('2026-09-08T10:00:00Z') })
    const report = command('backups', { directory, manifests, protectedIds: [] })
    await rotating
    expect(readdirSync(dailyDirectory).filter(name => name.startsWith('2026-'))).toHaveLength(7)
    expect(report.kept).toHaveLength(2)
    expect(existsSync(manifests[0])).toBe(false)
    expect(manifests.slice(1).every(existsSync)).toBe(true)
    expect(readFileSync(daily, 'utf8')).toBe('keep')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('does not let incomplete, unreadable, or changed-key sets displace two usable sets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'retention-'))
  try {
    const authPath = join(root, 'auth.sqlite'), chatPath = join(root, 'chat.sqlite'), directory = join(root, 'deployment-backups')
    for (const script of ['migrate.mjs', 'migrate-chat.mjs']) expect(spawnSync(process.execPath, [`scripts/${script}`], { env: { ...process.env, AUTH_DB_PATH: authPath, CHAT_DB_PATH: chatPath } }).status).toBe(0)
    const manifests = []
    for (let n = 0; n < 5; n++) manifests.push(await createBackupSet({ authPath, chatPath, directory,
      key: Buffer.alloc(32, n === 2 ? 10 : 9), deployment: true, now: new Date(`2026-09-25T10:00:0${n}Z`) }))
    rmSync(join(manifests[3], '..', 'chat.sqlite.enc'))
    writeFileSync(join(manifests[4], '..', 'auth.sqlite.enc'), 'damaged')
    const report = command('backups', { directory, manifests, protectedIds: [] })
    expect(report.kept).toHaveLength(2)
    expect(report.protected).toHaveLength(3)
    expect(manifests.every(existsSync)).toBe(true)
    expect(report.removed).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('preserves an older verified set referenced by unresolved recovery', async () => {
  const root = mkdtempSync(join(tmpdir(), 'retention-'))
  try {
    const authPath = join(root, 'auth.sqlite'), chatPath = join(root, 'chat.sqlite'), directory = join(root, 'deployment-backups')
    for (const script of ['migrate.mjs', 'migrate-chat.mjs']) expect(spawnSync(process.execPath, [`scripts/${script}`], { env: { ...process.env, AUTH_DB_PATH: authPath, CHAT_DB_PATH: chatPath } }).status).toBe(0)
    const manifests = []
    for (let n = 0; n < 3; n++) manifests.push(await createBackupSet({ authPath, chatPath, directory, key: Buffer.from(key, 'base64'), deployment: true, now: new Date(`2026-09-25T10:00:0${n}Z`) }))
    const id = JSON.parse(readFileSync(manifests[0])).id
    const report = command('backups', { directory, manifests, protectedIds: [id] })
    expect(report.kept).toHaveLength(3)
    expect(report.protected).toContainEqual({ id, reason: 'Unresolved deployment references this backup' })
    expect(manifests.every(existsSync)).toBe(true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('keeps accepted current and previous trees, shared images, and unresolved sources instead of a newer undeployed build', async () => {
  const { treeDigest } = await import('./deployment-state.mjs')
  const root = mkdtempSync(join(tmpdir(), 'retention-')), backupDirectory = join(root, 'deployment-backups')
  const releases = []
  try {
    for (let n = 0; n < 4; n++) {
      const source = join(root, `00000000-0000-0000-0000-00000000000${n}`, 'source')
      mkdirSync(source, { recursive: true }); writeFileSync(join(source, 'secret'), `private-${n}`)
      releases.push({ format: 1, result: 'active', source, tree: treeDigest(source), model: { services: { viewer: { image: `app@sha256:${n}` }, shared: { image: 'shared' } } }, runtime: { viewer: { image: `id-${n}` }, shared: { image: 'shared-id' } } })
    }
    const [old, previous, current, undeployed] = releases
    for (const release of [old, previous, current]) {
      writeFileSync(join(root, 'current.json'), JSON.stringify(release))
      command('record', { root })
    }
    const attempt = '10000000-0000-0000-0000-000000000000'
    mkdirSync(join(root, 'deployments'))
    writeFileSync(join(root, 'deployments', `${attempt}.json`), JSON.stringify({ attempt, phase: 'activation', result: 'maintenance-required',
      protection: { unresolved: true, sources: [old.source], images: ['id-0'], backups: [] } }))
    let report = command('clean', { root, backupDirectory })
    expect(report.releases).toEqual([current.source, previous.source, old.source])
    expect(report.images.protected).toContain('shared-id')
    expect(report.images.candidates).not.toContain('shared')
    expect(report.protected[0].reason).toContain('Unresolved')
    expect(existsSync(undeployed.source)).toBe(true)
    rmSync(join(root, 'deployments', `${attempt}.json`))
    report = command('clean', { root, backupDirectory })
    expect(report.releases).toEqual([current.source, previous.source])
    expect(existsSync(old.source)).toBe(false)
    expect(readFileSync(join(previous.source, 'secret'), 'utf8')).toBe('private-1')
    expect(report.registry.cleanup).toBe('disabled')
    expect(report.registry.protectedDigests).toEqual(['app@sha256:2', 'app@sha256:1'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('refuses cleanup when recovery metadata is unreadable and preserves all release files', async () => {
  const { treeDigest } = await import('./deployment-state.mjs')
  const root = mkdtempSync(join(tmpdir(), 'retention-'))
  try {
    const sources = []
    for (let n = 0; n < 3; n++) {
      const source = join(root, `00000000-0000-0000-0000-00000000000${n}`, 'source')
      sources.push(source); mkdirSync(source, { recursive: true }); writeFileSync(join(source, 'secret'), 'private')
      writeFileSync(join(root, 'current.json'), JSON.stringify({ format: 1, result: 'active', source, tree: treeDigest(source), model: { services: {} }, runtime: {} }))
      command('record', { root })
    }
    mkdirSync(join(root, 'deployments'))
    writeFileSync(join(root, 'deployments', '10000000-0000-0000-0000-000000000000.json'), 'broken')
    const result = spawnSync(process.execPath, ['scripts/deployment-retention.mjs', 'clean', JSON.stringify({ root, backupDirectory: join(root, 'backups') })])
    expect(result.status).not.toBe(0)
    expect(sources.every(existsSync)).toBe(true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('does not count an unacknowledged host transfer toward the two verified sets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'retention-'))
  try {
    const authPath = join(root, 'auth.sqlite'), chatPath = join(root, 'chat.sqlite'), directory = join(root, 'deployment-backups')
    for (const script of ['migrate.mjs', 'migrate-chat.mjs']) expect(spawnSync(process.execPath, [`scripts/${script}`], { env: { ...process.env, AUTH_DB_PATH: authPath, CHAT_DB_PATH: chatPath } }).status).toBe(0)
    const manifests = []
    for (let n = 0; n < 3; n++) manifests.push(await createBackupSet({ authPath, chatPath, directory, key: Buffer.from(key, 'base64'), deployment: true, now: new Date(`2026-09-25T10:00:0${n}Z`) }))
    const report = command('backups', { directory, manifests: manifests.slice(0, 2), protectedIds: [] })
    expect(report.kept).toHaveLength(2)
    expect(report.protected).toEqual([{ manifest: manifests[2], reason: 'No acknowledged deployment receipt owns this directory' }])
    expect(manifests.every(existsSync)).toBe(true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('retries private snapshot cleanup after its source directory was already removed', async () => {
  const { treeDigest } = await import('./deployment-state.mjs')
  const { chmodSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'retention-')), deployments = join(root, 'deployments')
  try {
    let baseline
    for (let n = 0; n < 3; n++) {
      const source = join(root, n === 0 ? 'baseline' : `00000000-0000-0000-0000-00000000000${n}`, 'source')
      mkdirSync(source, { recursive: true }); writeFileSync(join(source, 'secret'), 'private')
      const release = { format: 1, result: 'active', source, tree: treeDigest(source), model: { services: {} }, runtime: {} }
      baseline ??= release
      writeFileSync(join(root, 'current.json'), JSON.stringify(release)); command('record', { root })
    }
    mkdirSync(deployments)
    const attempt = '10000000-0000-0000-0000-000000000000', snapshot = join(deployments, `${attempt}-previous.json`)
    writeFileSync(snapshot, JSON.stringify(baseline))
    writeFileSync(join(deployments, `${attempt}.json`), JSON.stringify({ attempt, phase: 'complete', result: 'active' }))
    chmodSync(deployments, 0o500)
    const first = command('clean', { root, backupDirectory: join(root, 'backups') })
    expect(first.pending).toContainEqual({ source: baseline.source, reason: 'Release cleanup failed; retry cleanup' })
    expect(existsSync(baseline.source)).toBe(false)
    expect(existsSync(snapshot)).toBe(true)
    chmodSync(deployments, 0o700)
    const second = command('clean', { root, backupDirectory: join(root, 'backups') })
    expect(second.pending).toEqual([])
    expect(existsSync(snapshot)).toBe(false)
  } finally {
    if (existsSync(deployments)) chmodSync(deployments, 0o700)
    rmSync(root, { recursive: true, force: true })
  }
})
