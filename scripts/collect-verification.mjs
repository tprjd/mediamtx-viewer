import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { combineGroups } from './verify.mjs'
import { verificationGroups } from './verification-checks.mjs'
import { sourceFingerprint } from './chat-capacity/source.mjs'
import { githubReleaseClient } from './release-publication.mjs'

export function selectReports(reports, jobs, identity, now = Date.now()) {
  const selected = []
  const executionKey = job => JSON.stringify([job.started_at, job.completed_at,
    job.steps?.map(step => [step.number, step.name, step.status, step.conclusion, step.started_at, step.completed_at])])
  for (const group of Object.keys(verificationGroups)) {
    const candidates = jobs.filter(job => job.name === `Verify (${group})`)
    const attempt = Math.max(...candidates.map(job => job.run_attempt))
    const latest = candidates.filter(job => job.run_attempt === attempt)
    const job = latest[0]
    if (latest.length !== 1 || !Number.isSafeInteger(attempt) || attempt < 1 || attempt > Number(identity.runAttempt) ||
      String(job.run_id) !== identity.runId || job.status !== 'completed' || job.conclusion !== 'success') {
      throw new Error(`No successful latest job for ${group}`)
    }
    // GitHub creates new job IDs for retained successes and assigns the current
    // run_attempt, but preserves the original execution and step timestamps.
    // Resolve that execution to its first attempt rather than inventing a report
    // for work which was not run again.
    const execution = candidates.filter(candidate => Number.isSafeInteger(candidate.run_attempt) && candidate.run_attempt >= 1 &&
      candidate.status === 'completed' && candidate.conclusion === 'success' &&
      String(candidate.run_id) === identity.runId && executionKey(candidate) === executionKey(job))
      .sort((a, b) => a.run_attempt - b.run_attempt)[0]
    if (!Number.isFinite(Date.parse(execution.started_at)) || !Number.isFinite(Date.parse(execution.completed_at)) ||
      (execution.run_attempt < attempt && !job.steps?.length)) throw new Error(`Missing execution identity for ${group}`)
    const matches = reports.filter(report => report.group === group && Number(report.runAttempt) === execution.run_attempt)
    const report = matches[0]
    const age = now - Date.parse(report?.finishedAt)
    if (matches.length !== 1 || report.runId !== identity.runId || report.repository?.toLowerCase() !== identity.repository ||
      report.commit !== identity.commit || report.sourceFingerprint !== identity.sourceFingerprint || report.job !== 'verify' ||
      !Number.isFinite(age) || age < 0 || age > 86400000 ||
      Date.parse(report.startedAt) < Date.parse(execution.started_at) - 1000 ||
      Date.parse(report.finishedAt) > Date.parse(execution.completed_at) + 1000) throw new Error(`Missing, stale, or mismatched report for ${group}`)
    const expected = verificationGroups[group].commands.map(([, bin, args]) => [bin, ...args])
    if (JSON.stringify(report.checks?.map(check => check.command)) !== JSON.stringify(expected)) throw new Error(`Wrong commands for ${group}`)
    selected.push({ ...report, jobId: execution.id, retainedJobId: job.id, jobStartedAt: job.started_at, jobFinishedAt: job.completed_at })
  }
  // Validate the complete group set, including checks and source identity.
  combineGroups(selected)
  return selected
}

export function verificationSummary(reports) {
  const seconds = value => (value / 1000).toFixed(1)
  const duration = report => Date.parse(report.jobFinishedAt) - Date.parse(report.jobStartedAt)
  const rows = reports.map(report => `| ${report.group} | ${seconds(Date.parse(report.startedAt) - Date.parse(report.jobStartedAt))} | ${seconds(report.durationMs)} | ${seconds(duration(report))} | ${report.runAttempt} |`)
  return ['## Source verification', '', '| Group | Setup seconds | Check seconds | Job seconds | Attempt |', '| --- | ---: | ---: | ---: | ---: |', ...rows, '',
    `Total source runner time: ${seconds(reports.reduce((sum, report) => sum + duration(report), 0))} seconds.`,
    `Source wall time (including queue gaps and reruns): ${seconds(Math.max(...reports.map(report => Date.parse(report.jobFinishedAt))) - Math.min(...reports.map(report => Date.parse(report.jobStartedAt))))} seconds.`,
    'Successful jobs from earlier attempts retain their original reports.', ''].join('\n')
}

export async function collectVerification(directory, output) {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Collect release evidence in GitHub Actions')
  const identity = { repository: process.env.GITHUB_REPOSITORY?.toLowerCase(), runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceFingerprint: sourceFingerprint() }
  if (!/^[1-9]\d*$/.test(identity.runId ?? '') || !/^[1-9]\d*$/.test(identity.runAttempt ?? '')) throw new Error('Invalid workflow identity')
  const { request } = githubReleaseClient()
  const run = await request(`/actions/runs/${identity.runId}/attempts/${identity.runAttempt}`)
  if (String(run.id) !== identity.runId || String(run.run_attempt) !== identity.runAttempt || run.head_sha !== identity.commit ||
    run.path !== '.github/workflows/release.yml' || run.repository?.full_name?.toLowerCase() !== identity.repository) throw new Error('Wrong release workflow or source')
  const jobs = []
  for (let page = 1; ; page++) {
    const result = await request(`/actions/runs/${identity.runId}/jobs?filter=all&per_page=100&page=${page}`)
    jobs.push(...result.jobs)
    if (result.jobs.length < 100) break
  }
  const reports = readdirSync(directory).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')))
  const selected = selectReports(reports, jobs, identity)
  const checks = { ...combineGroups(selected), repository: identity.repository, commit: identity.commit, runId: identity.runId, runAttempt: identity.runAttempt }
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify(checks, null, 2) + '\n')
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, verificationSummary(selected))
  return checks
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await collectVerification(process.argv[2] ?? '.data/verification', process.argv[3] ?? '.data/release/checks.json') }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
