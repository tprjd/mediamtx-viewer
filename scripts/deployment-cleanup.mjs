import { dirname, join } from 'node:path'
import { retainBackups } from './deployment-retention.mjs'

// Cleanup failure does not undo an accepted deployment or reopen maintenance.
export async function cleanupDeployment({ docker, tool, directory, authPath, read, save, attempt, record = false }) {
  const report = { status: 'pending', pending: [] }
  const command = (action, value) => JSON.parse(docker('exec', '-e', 'AUTH_BACKUP_KEY', tool, 'node', '/app/scripts/deployment-retention.mjs', action, JSON.stringify(value)))
  try {
    if (record) command('record', { root: '/stage', attempt })
    // Resolve every retained image before allowing removal of successful history.
    const history = read('/stage/retention.json')
    for (const release of history.releases.slice(0, 2)) for (const runtime of Object.values(release.runtime)) docker('image', 'inspect', runtime.image)
    const host = command('clean', { root: '/stage', backupDirectory: join(dirname(authPath), 'deployment-backups') })
    report.host = { releases: host.releases, backups: host.backups, protected: host.protected }
    report.registry = host.registry
    report.pending.push(...host.pending, ...host.backups.pending)
    // Host receipts are the authority after reconnecting. Never trust an old local inventory.
    report.workstation = await retainBackups({ directory: join(directory, 'backups'),
      manifests: host.workstation.receipts.map(receipt => receipt.workstationManifest).filter(Boolean), protectedIds: host.workstation.protectedIds })
    report.pending.push(...report.workstation.pending)
    const ids = docker('image', 'ls', '-aq', '--no-trunc').split('\n').filter(Boolean)
    const inventory = ids.length ? JSON.parse(docker('image', 'inspect', ...new Set(ids))) : []
    const find = reference => inventory.find(image => image.Id === reference || image.RepoDigests?.includes(reference) || image.RepoTags?.includes(reference))
    const protectedIds = new Set(host.images.protected.map(reference => {
      return JSON.parse(docker('image', 'inspect', reference))[0].Id
    }))
    for (const reference of host.images.candidates) {
      if (!/^(?:sha256:[a-f0-9]{64}|[^\s]+@sha256:[a-f0-9]{64})$/.test(reference)) {
        report.pending.push({ image: reference, reason: 'Mutable image reference has no recorded immutable identity; keep it' })
        continue
      }
      const image = find(reference)
      if (!image || protectedIds.has(image.Id)) continue
      try { docker('image', 'rm', reference) }
      catch { report.pending.push({ image: reference, reason: 'Image is in use or removal failed; retry cleanup' }) }
    }
    report.status = report.pending.length || host.backups.protected.length || report.workstation.protected.length || host.protected.length ? 'protected-or-pending' : 'complete'
  } catch { report.pending.push({ reason: 'Cleanup could not verify ownership or protection; retained files need inspection' }) }
  try { save('/stage/retention-status.json', report) } catch { report.pending.push({ reason: 'Cleanup status could not be saved; retry cleanup' }); report.status = 'pending' }
  return report
}
