// @vitest-environment node
import { expect, it } from 'vitest'
import { selectReports } from './collect-verification.mjs'
import { verificationGroups } from './verification-checks.mjs'

function fixture() {
  const identity = { repository: 'owner/viewer', commit: 'a'.repeat(40), sourceFingerprint: 'b'.repeat(64), runId: '123', runAttempt: '2' }
  const now = Date.now()
  const reports = Object.entries(verificationGroups).map(([group, definition]) => ({
    ...identity, version: 1, group, job: 'verify', runAttempt: group === 'browser' ? '2' : '1', passed: true,
    startedAt: new Date(now - 2000).toISOString(), finishedAt: new Date(now - 1000).toISOString(), durationMs: 1000,
    checks: definition.commands.map(([name, bin, args]) => ({ name, command: [bin, ...args], passed: true })),
  }))
  const jobs = reports.map((report, i) => ({ id: i + 1, name: `Verify (${report.group})`, run_id: 123,
    run_attempt: Number(report.runAttempt), status: 'completed', conclusion: 'success',
    started_at: new Date(now - 3000).toISOString(), completed_at: new Date(now - 500).toISOString() }))
  return { identity, reports, jobs, now }
}

it('reuses successful prior-attempt jobs after the failed browser job is rerun', () => {
  const { reports, jobs, identity, now } = fixture()
  const oldBrowser = { ...reports.find(report => report.group === 'browser'), passed: false, runAttempt: '1' }
  reports.push(oldBrowser)
  jobs.push({ ...jobs.find(job => job.name === 'Verify (browser)'), id: 99, run_attempt: 1, conclusion: 'failure' })
  const selected = selectReports(reports, jobs, identity, now)
  expect(selected.find(report => report.group === 'browser').runAttempt).toBe('2')
  expect(selected.find(report => report.group === 'unit').runAttempt).toBe('1')
})

it.each(['failed', 'cancelled', 'skipped', 'missing', 'wrong-run', 'wrong-source', 'wrong-attempt', 'wrong-job', 'wrong-command', 'duplicate', 'stale', 'future', 'incomplete'])('rejects %s group evidence', failure => {
  const { reports, jobs, identity, now } = fixture()
  if (failure === 'failed') jobs[0].conclusion = 'failure'
  if (failure === 'cancelled') jobs[0].conclusion = 'cancelled'
  if (failure === 'skipped') jobs[0].conclusion = 'skipped'
  if (failure === 'missing') reports.pop()
  if (failure === 'wrong-run') reports[0].runId = 'other'
  if (failure === 'wrong-source') reports[0].commit = 'c'.repeat(40)
  if (failure === 'wrong-attempt') reports[0].runAttempt = '3'
  if (failure === 'wrong-job') reports[0].job = 'other'
  if (failure === 'wrong-command') reports[0].checks[0].command = ['true']
  if (failure === 'duplicate') reports.push(reports[0])
  if (failure === 'stale') reports[0].finishedAt = new Date(now - 86400001).toISOString()
  if (failure === 'future') reports[0].finishedAt = new Date(now + 1).toISOString()
  if (failure === 'incomplete') reports[0].checks.pop()
  expect(() => selectReports(reports, jobs, identity, now)).toThrow()
})

it('does not fall back to an older success after a newer job fails', () => {
  const { reports, jobs, identity, now } = fixture()
  jobs.push({ ...jobs[0], id: 99, run_attempt: 2, conclusion: 'failure' })
  expect(() => selectReports(reports, jobs, identity, now)).toThrow('No successful latest job')
})
