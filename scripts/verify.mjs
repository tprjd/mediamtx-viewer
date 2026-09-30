import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sourceFingerprint } from './chat-capacity/source.mjs'
import { requiredChecks, verificationGroups } from './verification-checks.mjs'

async function prerequisites(tools) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24, then run npm ci with that Node version.')
  for (const tool of tools) {
    if (tool === 'chromium') {
      const { chromium } = await import('@playwright/test')
      if (!existsSync(chromium.executablePath())) throw new Error('Install Chromium: npx playwright install --with-deps chromium')
      continue
    }
    const args = tool === 'docker' ? ['info', '--format', '{{.ServerVersion}}'] : [tool === 'age-keygen' ? '-version' : '--version']
    if (spawnSync(tool, args, { stdio: 'ignore' }).status !== 0) throw new Error(`Required tool ${tool} is unavailable. See docs/verification.md.`)
    if (tool === 'docker' && spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status !== 0) throw new Error('Install Docker Compose v2. See docs/verification.md.')
  }
}

export async function runGroup(group, output, { commands, checkTools = prerequisites, fingerprint = sourceFingerprint } = {}) {
  const definition = verificationGroups[group]
  if (!definition) throw new Error(`Unknown verification group: ${group}`)
  const startedAt = new Date().toISOString()
  const report = {
    version: 1, group, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceFingerprint: fingerprint(), startedAt,
    ...(process.env.GITHUB_ACTIONS === 'true' ? {
      repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT, job: process.env.GITHUB_JOB,
    } : {}),
    checks: [], passed: false,
  }
  mkdirSync(dirname(output), { recursive: true })
  const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  save()
  try {
    await checkTools(definition.tools)
    for (const [name, bin, args] of commands ?? definition.commands) {
      const start = Date.now()
      console.log(`Verification ${group}: ${name}`)
      const result = spawnSync(bin, args, { stdio: 'inherit', env: { ...process.env, CI: '1', NEXT_TELEMETRY_DISABLED: '1' } })
      const check = { name, command: [bin, ...args], startedAt: new Date(start).toISOString(),
        finishedAt: new Date().toISOString(), durationMs: Date.now() - start,
        passed: result.status === 0, exitCode: result.status, signal: result.signal }
      report.checks.push(check)
      save()
      if (!check.passed) throw new Error(`${name} failed: ${result.error?.message ?? `exit ${result.status}, signal ${result.signal ?? 'none'}`}`)
    }
    if (report.sourceFingerprint !== fingerprint()) throw new Error('Source changed during verification')
    report.passed = true
  } catch (error) {
    report.error = error.message
    console.error(error.message)
  } finally {
    report.finishedAt = new Date().toISOString()
    report.durationMs = Date.parse(report.finishedAt) - Date.parse(startedAt)
    save()
  }
  return report
}

export function combineGroups(reports) {
  const groups = Object.keys(verificationGroups)
  if (reports.length !== groups.length || new Set(reports.map(report => report.group)).size !== groups.length) throw new Error('Missing or duplicate verification groups')
  const first = reports[0]
  for (const group of groups) {
    const report = reports.find(item => item.group === group)
    const expected = verificationGroups[group].commands.map(([name]) => name)
    if (!report || report.version !== 1 || !report.passed || report.commit !== first.commit || report.sourceFingerprint !== first.sourceFingerprint ||
      report.checks.length !== expected.length || expected.some((name, index) => report.checks[index]?.name !== name || report.checks[index]?.passed !== true) ||
      !Number.isFinite(Date.parse(report.startedAt)) || !Number.isFinite(Date.parse(report.finishedAt)) || Date.parse(report.finishedAt) < Date.parse(report.startedAt)) {
      throw new Error(`Incomplete or mismatched verification group: ${group}`)
    }
  }
  return { version: 1, passed: true, sourceFingerprint: first.sourceFingerprint,
    startedAt: reports.map(report => report.startedAt).sort()[0],
    finishedAt: reports.map(report => report.finishedAt).sort().at(-1),
    checks: requiredChecks.map(name => ({ name, passed: true })), groups: reports }
}

export async function runAll(output) {
  const reports = []
  for (const group of Object.keys(verificationGroups)) {
    const report = await runGroup(group, resolve(dirname(output), 'groups', `${group}.json`))
    reports.push(report)
    if (!report.passed) {
      writeFileSync(output, JSON.stringify({ version: 1, passed: false, groups: reports }, null, 2) + '\n')
      return false
    }
  }
  writeFileSync(output, JSON.stringify(combineGroups(reports), null, 2) + '\n')
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [group = 'all', output = `.data/verification/${group}.json`] = process.argv.slice(2)
  try {
    if (group === 'list') console.log(JSON.stringify(Object.keys(verificationGroups)))
    else if (!(group === 'all' ? await runAll(output) : (await runGroup(group, output)).passed)) process.exitCode = 1
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
