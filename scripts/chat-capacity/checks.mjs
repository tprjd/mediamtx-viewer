import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { sourceFingerprint } from './source.mjs'
import { verificationCommands as commands } from '../verification-checks.mjs'

const output = process.argv[2]
if (!output) throw new Error('Usage: node scripts/chat-capacity/checks.mjs REPORT.json')
const report = {version: 1, sourceFingerprint: sourceFingerprint(), startedAt: new Date().toISOString(), checks: []}
for (const [name, command, args] of commands) {
  const result = spawnSync(command, args, {stdio: 'inherit', env: {...process.env, CI: '1'}})
  if (result.error) console.error(`Cannot start ${name}: ${result.error.message}`)
  else if (result.status !== 0) console.error(`${name} failed: exit ${result.status}, signal ${result.signal ?? 'none'}`)
  report.checks.push({name, passed: result.status === 0})
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  if (result.status !== 0) { process.exitCode = 1; break }
}
report.finishedAt = new Date().toISOString()
if (report.sourceFingerprint !== sourceFingerprint()) report.checks.push({name: 'source-unchanged', passed: false})
report.passed = report.checks.length === commands.length && report.checks.every(check => check.passed)
writeFileSync(output, JSON.stringify(report, null, 2) + '\n')

if (!report.passed) process.exitCode = 1
