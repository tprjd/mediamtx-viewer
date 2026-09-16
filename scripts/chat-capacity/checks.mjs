import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { sourceFingerprint } from './source.mjs'

const output = process.argv[2]
if (!output) throw new Error('Usage: node scripts/chat-capacity/checks.mjs REPORT.json')
const commands = [
  ['lint', 'npm', ['run', 'lint']],
  ['type', 'npm', ['run', 'typecheck']],
  ['test', 'npm', ['test']],
  ['browser', 'npx', ['playwright', 'test', '--workers=2']],
  ['restore', 'npm', ['run', 'chat:restore-drill']],
  ['build', 'npm', ['run', 'build', '--', '--webpack']],
  ['streaming-contract', 'npm', ['run', 'validate:streaming-contract']],
  ['deployment', 'node', ['scripts/validate-chat-deployment.mjs']],
]
const report = {version: 1, sourceFingerprint: sourceFingerprint(), startedAt: new Date().toISOString(), checks: []}
for (const [name, command, args] of commands) {
  const result = spawnSync(command, args, {stdio: 'inherit', env: {...process.env, CI: '1'}})
  report.checks.push({name, passed: result.status === 0})
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  if (result.status !== 0) { process.exitCode = 1; break }
}
report.finishedAt = new Date().toISOString()
if (report.sourceFingerprint !== sourceFingerprint()) report.checks.push({name: 'source-unchanged', passed: false})
report.passed = report.checks.length === commands.length && report.checks.every(check => check.passed)
writeFileSync(output, JSON.stringify(report, null, 2) + '\n')

if (!report.passed) process.exitCode = 1
