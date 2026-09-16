import { readFileSync } from 'node:fs'
import { sourceFingerprint } from './source.mjs'
import { capacityFailures, storageFailures } from './report.mjs'

const [action, checksPath, hostPath, capacityPath] = process.argv.slice(2)
if (!['trial', 'enable'].includes(action) || !checksPath || !hostPath || !capacityPath)
  throw new Error('Usage: rollout-gate.mjs trial|enable CHECKS.json HOST.json CAPACITY_OR_STORAGE.json')
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const checks = read(checksPath)
const host = read(hostPath)
const evidence = read(capacityPath)
const names = ['lint', 'type', 'test', 'browser', 'restore', 'build', 'streaming-contract', 'deployment']
const failures = []
const fresh = timestamp => Number.isFinite(Date.parse(timestamp)) &&
  Date.now() - Date.parse(timestamp) >= 0 && Date.now() - Date.parse(timestamp) <= 86400000
if (!checks.passed || !fresh(checks.finishedAt) || names.some(name =>
  !checks.checks?.some(check => check.name === name && check.passed === true))) failures.push('verification')
if (!Number.isFinite(host.cpuPercent) || host.cpuPercent > 70 || host.architecture !== 'aarch64' || host.memoryAvailableBytes < 1024 ** 3 ||
    host.database?.integrity !== 'ok' || !Number.isSafeInteger(host.database?.outboxDepth) ||
    host.database.outboxDepth < 0 || (action === 'enable' && host.database.outboxDepth !== 0) ||
    host.containers?.length !== 2 || host.containers.some(c => !c.running || c.health !== 'healthy')) failures.push('host')
if (checks.sourceFingerprint !== sourceFingerprint() || !/^[a-f0-9]{64}$/.test(checks.sourceFingerprint ?? '') || checks.sourceFingerprint !== host.containers?.find(c => c.service === 'viewer')?.sourceFingerprint) failures.push('source-changed')
failures.push(...storageFailures(action === 'enable' ? evidence.storage : evidence, host))
if (action === 'enable') {
  failures.push(...capacityFailures(evidence))
  if (!fresh(evidence.finishedAt) || evidence.viewerImage !== host.containers.find(c => c.service === 'viewer')?.imageId ||
      evidence.centrifugoImage !== host.containers.find(c => c.service === 'centrifugo')?.image) failures.push('deployment-changed')
}
if (failures.length) {
  console.error(JSON.stringify({passed: false, failures}))
  process.exitCode = 1
} else console.log(JSON.stringify({passed: true, action}))
