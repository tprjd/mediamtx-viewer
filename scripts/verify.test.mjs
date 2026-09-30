// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { combineGroups, runGroup } from './verify.mjs'
import { verificationGroups, requiredChecks } from './verification-checks.mjs'

const reports = () => Object.entries(verificationGroups).map(([group, definition]) => ({
  version: 1, group, commit: 'a'.repeat(40), sourceFingerprint: 'b'.repeat(64), passed: true,
  startedAt: '2026-09-30T10:00:00Z', finishedAt: '2026-09-30T10:01:00Z',
  checks: definition.commands.map(([name]) => ({ name, passed: true })),
}))

it('requires both test partitions and every other check before combining evidence', () => {
  expect(combineGroups(reports()).checks).toEqual(requiredChecks.map(name => ({ name, passed: true })))
  expect(() => combineGroups(reports().filter(report => report.group !== 'docker'))).toThrow()
  for (const mutate of [
    values => { values[1].passed = false },
    values => { values[1].sourceFingerprint = 'wrong' },
    values => { values[1].commit = 'wrong' },
    values => { values[1].checks = [] },
    values => { values[1].checks[0].passed = false },
    values => { values[1] = values[0] },
  ]) {
    const values = reports(); mutate(values)
    expect(() => combineGroups(values)).toThrow()
  }
})

it('records the real command failure and does not run later checks', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'verification-test-'))
  try {
    const output = join(directory, 'failure.json')
    await runGroup('unit', output, { checkTools: async () => {}, fingerprint: () => 'fixture', commands: [
      ['test', process.execPath, ['-e', 'process.exit(7)']],
      ['unexpected', process.execPath, ['-e', 'process.exit(0)']],
    ] })
    const report = JSON.parse(readFileSync(output, 'utf8'))
    expect(report.passed).toBe(false)
    expect(report.checks).toHaveLength(1)
    expect(report.checks[0]).toMatchObject({ exitCode: 7, passed: false })
    expect(report.durationMs).toBeGreaterThanOrEqual(0)
    expect(report.finishedAt).toBeTruthy()
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

it('saves prerequisite failures and rejects changes during verification', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'verification-test-'))
  try {
    const output = join(directory, 'failure.json')
    const report = await runGroup('unit', output, { checkTools: async () => { throw new Error('Missing tool') } })
    expect(report).toMatchObject({ passed: false, error: 'Missing tool', checks: [] })
    let calls = 0
    const changed = await runGroup('unit', output, { checkTools: async () => {}, commands: [], fingerprint: () => String(calls++) })
    expect(changed).toMatchObject({ passed: false, error: 'Source changed during verification' })
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
