// Explicit maintenance command. The caller must hold the deployment owner lock.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyBackupSet } from './backup-verification.mjs'
import { treeDigest, saveDeploymentState as save } from './deployment-state.mjs'

const read = path => JSON.parse(readFileSync(path, 'utf8'))
function ownedDirectory(root, path) {
  if (existsSync(root) && lstatSync(root).isSymbolicLink()) throw new Error('Retention root is not private storage')
  const relative = path.slice(root.length + 1)
  if (!path.startsWith(`${root}/`) || !relative || relative.includes('/') || relative === '..' || relative === '.') throw new Error('Retention ownership is unknown')
  if (existsSync(path) && (lstatSync(path).isSymbolicLink() || realpathSync(path) !== join(realpathSync(root), relative))) throw new Error('Retention path is not private storage')
  return path
}
function regularSet(path) {
  const names = readdirSync(path).sort()
  if (names.join() !== ['auth.sqlite.enc', 'chat.sqlite.enc', 'manifest.json'].join() ||
      names.some(name => !lstatSync(join(path, name)).isFile() || lstatSync(join(path, name)).isSymbolicLink())) throw new Error('Backup set contains unknown files')
}
export async function retainBackups({ directory, manifests, protectedIds }) {
  const report = { kept: [], removed: [], protected: [], pending: [] }, verified = []
  // Only receipts from this host authorize deletion. Unknown directories stay untouched.
  for (const manifest of [...new Set(manifests)]) {
    try {
      const folder = ownedDirectory(directory, dirname(manifest))
      if (manifest !== join(folder, 'manifest.json')) throw new Error('Unknown manifest')
      if (!existsSync(folder)) continue
      regularSet(folder)
      const value = await verifyBackupSet(manifest)
      verified.push({ manifest, folder, id: value.id, createdAt: value.createdAt })
    } catch { report.protected.push({ manifest, reason: 'Set is incomplete, unreadable, or ownership cannot be verified' }) }
  }
  if (existsSync(directory)) for (const name of readdirSync(directory)) {
    const manifest = join(directory, name, 'manifest.json')
    if (!manifests.includes(manifest)) report.protected.push({ manifest, reason: 'No acknowledged deployment receipt owns this directory' })
  }
  verified.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  for (const [index, set] of verified.entries()) {
    if (index < 2 || protectedIds.includes(set.id)) {
      report.kept.push(set.id)
      if (index >= 2) report.protected.push({ id: set.id, reason: 'Unresolved deployment references this backup' })
    } else {
      try { rmSync(set.folder, { recursive: true }); report.removed.push(set.id) }
      catch { report.pending.push({ id: set.id, reason: 'Backup removal failed; retry cleanup' }) }
    }
  }
  return report
}
function inventory(root) {
  const records = [], directory = join(root, 'deployments')
  if (existsSync(directory)) for (const name of readdirSync(directory)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue
    const state = read(join(directory, name))
    if (state.attempt !== name.slice(0, -5)) throw new Error('Deployment record identity differs')
    records.push(state)
  }
  const unresolved = records.filter(state => state.phase !== 'complete' && state.result !== 'rejected')
  // Incomplete protection metadata cannot establish deletion safety.
  if (unresolved.some(state => !state.protection?.unresolved || !Array.isArray(state.protection.sources) || !Array.isArray(state.protection.images) || !Array.isArray(state.protection.backups))) throw new Error('Recovery protection is unknown')
  return { records, unresolved }
}
const images = release => [...new Set([...Object.values(release.model.services).map(service => service.image), ...Object.values(release.runtime).map(service => service.image)])]
function sourceDirectory(root, source) {
  if (!source?.endsWith('/source')) throw new Error('Release source ownership is unknown')
  const directory = ownedDirectory(root, dirname(source))
  if (!/^(baseline|[a-f0-9-]{36})$/.test(directory.slice(root.length + 1))) throw new Error('Release source ownership is unknown')
  return directory
}
export function recordSuccess({ root, attempt }) {
  const path = join(root, 'retention.json'), current = read(join(root, 'current.json'))
  const history = existsSync(path) ? read(path) : { releases: [], retiredImages: [] }
  if (attempt !== undefined && !/^[a-f0-9-]{36}$/.test(attempt)) throw new Error('Deployment identity differs')
  const previous = attempt ? read(join(root, 'deployments', `${attempt}-previous.json`)) : undefined
  for (const release of [previous, current]) {
    if (!release) continue
    sourceDirectory(root, release.source)
    if (release.format !== 1 || release.result !== 'active') throw new Error('Release was not accepted')
    history.releases = [release, ...history.releases.filter(item => item.source !== release.source)]
  }
  save(path, history)
  return {}
}
export async function cleanHost({ root, backupDirectory }) {
  const { records, unresolved } = inventory(root), path = join(root, 'retention.json')
  const history = read(path), current = read(join(root, 'current.json'))
  if (history.releases[0]?.source !== current.source) throw new Error('Successful release history differs')
  history.releases[0] = current
  const protectedSources = new Set(unresolved.flatMap(state => state.protection.sources))
  const retained = history.releases.filter((release, index) => index < 2 || protectedSources.has(release.source))
  // Verify the rollback trees before removing any successful history.
  for (const release of retained) {
    sourceDirectory(root, release.source)
    if (treeDigest(release.source) !== release.tree) throw new Error('Retained release files changed')
  }
  const protectedImages = [...new Set([...retained.flatMap(images), ...unresolved.flatMap(state => state.protection.images)])]
  const report = { releases: retained.map(release => release.source), protected: unresolved.map(state => ({ attempt: state.attempt, reason: 'Unresolved deployment retains its source, images, secrets, and backups' })), pending: [] }
  const obsolete = history.releases.filter(release => !retained.includes(release))
  // Known failed candidates are eligible only after a later accepted deployment.
  const candidates = [...obsolete.map(release => release.source), ...records.filter(state => !unresolved.includes(state)).flatMap(state => [state.staging?.source, state.candidateRelease?.source]).filter(Boolean)]
  const keep = new Set([...report.releases, ...protectedSources])
  for (const source of [...new Set(candidates)]) {
    if (keep.has(source)) continue
    try {
      const directory = sourceDirectory(root, source)
      if (existsSync(directory)) rmSync(directory, { recursive: true })
      // Historical snapshots contain private Compose environments too.
      for (const state of records.filter(state => !unresolved.includes(state))) {
        const snapshot = join(root, 'deployments', `${state.attempt}-previous.json`)
        if (existsSync(snapshot) && read(snapshot).source === source) rmSync(snapshot)
      }
    } catch { report.pending.push({ source, reason: 'Release cleanup failed; retry cleanup' }) }
  }
  history.retiredImages = [...new Set([...history.retiredImages, ...obsolete.flatMap(images), ...records.filter(state => !unresolved.includes(state)).flatMap(state => state.staging?.images ?? [])])].filter(image => !protectedImages.includes(image))
  history.releases = history.releases.filter(release => keep.has(release.source) || existsSync(release.source) || report.pending.some(item => item.source === release.source))
  save(path, history)
  const receipts = records.map(state => state.backup).filter(Boolean)
  const protectedIds = unresolved.flatMap(state => state.protection.backups).map(backup => backup.backupId).filter(Boolean)
  report.backups = await retainBackups({ directory: backupDirectory, manifests: receipts.filter(backup => backup.acknowledged && backup.workstationManifest && backup.backupId).map(backup => backup.hostManifest).filter(Boolean), protectedIds })
  report.workstation = { receipts, protectedIds }
  report.images = { protected: protectedImages, candidates: history.retiredImages }
  // No registry deletion runs from CI or deployment. Never infer protection from publication age.
  report.registry = { cleanup: 'disabled', protectedDigests: protectedImages.filter(image => image.includes('@sha256:')), reason: 'Keep registry images; deployment references are not a registry-wide inventory' }
  return report
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, json] = process.argv.slice(2), input = JSON.parse(json)
    const result = action === 'backups' ? await retainBackups(input) : action === 'record' ? recordSuccess(input) : action === 'clean' ? await cleanHost(input) : undefined
    if (!result) throw new Error('Unknown retention operation')
    console.log(JSON.stringify(result))
  } catch { console.error('Retention could not establish protected files; nothing further removed'); process.exitCode = 1 }
}
