// Read-only checks of the existing installation. Only /stage is writable.
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, statfsSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

function space(path, bytes, files) {
  const fs = statfsSync(path)
  const freeBytes = fs.bavail * fs.bsize
  if (![freeBytes, fs.files, fs.ffree, bytes, files].every(Number.isSafeInteger) || freeBytes < bytes || fs.files <= 0 || fs.ffree < files) throw new Error('Host bytes or inodes are insufficient or unknown')
  return { freeBytes, freeInodes: fs.ffree, requiredBytes: bytes, requiredInodes: files }
}
const positive = value => Number.isSafeInteger(value) && value > 0
const cpu = () => readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1, 9).map(Number)
try {
  const [action, json] = process.argv.slice(2)
  const input = JSON.parse(json)
  if (action === 'save') {
    chmodSync('/stage', 0o700)
    mkdirSync(`/stage/${input.attempt}`, { recursive: true, mode: 0o700 })
    writeFileSync('/stage/status.next', JSON.stringify(input), { mode: 0o600, flush: true })
    renameSync('/stage/status.next', '/stage/status.json')
    console.log('{}')
  } else if (action === 'check') {
    const memory = Number(/^MemAvailable:\s+(\d+)/m.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1]) * 1024
    const start = cpu()
    await delay(1000)
    const end = cpu()
    const total = end.reduce((a, b) => a + b, 0) - start.reduce((a, b) => a + b, 0)
    const percent = 100 * (1 - (end[3] + end[4] - start[3] - start[4]) / total)
    if (!Number.isFinite(memory) || memory < 1024 ** 3 || !Number.isFinite(percent) || percent < 0 || percent > 70) throw new Error('Host memory or sampled CPU check failed')
    const minimum = Math.max(10737418240, input.minimumFreeBytes)
    const limit = input.databaseLimitBytes
    if (!positive(minimum) || !positive(limit)) throw new Error('Runtime storage limits are invalid')
    const databaseBytes = input.databaseBytes
    if (!positive(databaseBytes)) throw new Error('Database measurement is invalid')
    // Existing protected images and backups already consume measured free space.
    // Reserve snapshots, SQLite working copies, encrypted sets, and database growth.
    const snapshotBytes = databaseBytes * 6 + 64 * 1024 ** 2
    const backupBytes = snapshotBytes + limit
    const costs = [
      { path: '/stage', bytes: input.stageBytes, files: input.files * 2 + 32 },
      { path: '/docker-storage', bytes: input.imageBytes, files: input.imageBytes > 0 ? 100000 : 32 },
      { path: dirname(input.databases.auth), bytes: snapshotBytes, files: 128 },
      { path: dirname(input.databases.chat), bytes: limit + minimum, files: 64 },
    ]
    const filesystems = new Map()
    for (const cost of costs) {
      const device = statSync(cost.path).dev
      if (!Number.isSafeInteger(device)) throw new Error('Host filesystem measurement failed')
      const group = filesystems.get(device) ?? { ...cost, bytes: 0, files: 0 }
      group.bytes += cost.bytes
      group.files += cost.files
      filesystems.set(device, group)
    }
    const storage = [...filesystems.values()].map(cost => space(cost.path, cost.bytes, cost.files))
    console.log(JSON.stringify({ memoryAvailableBytes: memory, cpuPercent: percent, backupBytes, storage }))
  } else throw new Error('Unknown staging host operation')
} catch (error) {
  // SQLite and file errors can contain private paths. Emit only controlled messages.
  const reason = /^(Host |Runtime |Database |Chat )/.test(error.message) ? error.message : `Host measurement failed (${error.code || error.name})`
  console.error(reason)
  process.exitCode = 1
}
