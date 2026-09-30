import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { verificationGroups } from './verification-checks.mjs'

export function branchGroups(paths, full = false) {
  // Only these inputs are known not to affect the isolated deployment fixtures.
  // Unknown paths, deleted dependencies, and missing diff history run everything.
  const frontendOnly = paths?.length && paths.every(path => /^(?:components\/|hooks\/|public\/|tests\/e2e\/|docs\/|\.scratch\/|README\.md$|CHANGELOG\.md$)/.test(path))
  return Object.keys(verificationGroups).filter(group => full || !frontendOnly || !group.startsWith('docker'))
}

export async function branchPlan(event, env = process.env) {
  let run = true
  if (env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF_NAME !== 'main') {
    const query = new URLSearchParams({ state: 'open', head: `${env.GITHUB_REPOSITORY_OWNER}:${env.GITHUB_REF_NAME}` })
    try {
      const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/pulls?${query}`, {
        headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) throw new Error('Pull request lookup failed')
      run = (await response.json()).length === 0
    } catch { console.log('Could not check for a pull request; retaining branch verification.') }
  }
  const base = event.pull_request?.base?.sha ?? event.before
  let paths
  if (/^[a-f0-9]{40}$/.test(base ?? '') && !/^0+$/.test(base)) {
    try { paths = execFileSync('git', ['diff', '--name-only', '-z', base, 'HEAD'], { encoding: 'utf8' }).split('\0').filter(Boolean) }
    catch { /* Missing history requires full verification. */ }
  }
  const full = env.GITHUB_EVENT_NAME === 'workflow_dispatch' && event.inputs?.full !== 'false'
  return { run, matrix: { group: branchGroups(paths, full) } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await branchPlan(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')))
  appendFileSync(process.env.GITHUB_OUTPUT, `run=${result.run}\nmatrix=${JSON.stringify(result.matrix)}\n`)
}
