// @vitest-environment node
import { createServer } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { selectedRelease } from './stage-release-source.mjs'
import { requiredChecks } from './verification-checks.mjs'

afterEach(() => vi.unstubAllEnvs())

async function fixture(fault, run) {
  const record = { format: 2, repository: 'owner/viewer', tag: 'v1.2.3', version: '1.2.3',
    commit: 'a'.repeat(40), tagObject: 'b'.repeat(40), sourceFingerprint: 'c'.repeat(64),
    images: Object.fromEntries(['viewer', 'thumbnailer'].map(name => [name, `ghcr.io/owner/viewer/${name}@sha256:${'d'.repeat(64)}`])),
    verification: { version: 1, passed: true, sourceFingerprint: 'c'.repeat(64), finishedAt: '2020-01-01T00:00:00Z',
      runId: '1', runAttempt: '1', checks: requiredChecks.map(name => ({ name, passed: true })) } }
  if (fault === 'legacy') record.format = 1
  if (fault === 'unknown-format') record.format = 3
  if (fault === 'future') record.verification.finishedAt = '2100-01-01T00:00:00Z'
  if (fault === 'invalid-date') record.verification.finishedAt = 'invalid'
  if (fault === 'source') record.verification.sourceFingerprint = 'e'.repeat(64)
  if (fault === 'missing-check') record.verification.checks.pop()
  if (fault === 'failed-check') record.verification.checks[0].passed = false
  const requests = []
  const server = createServer((req, res) => {
    requests.push(req.url)
    res.setHeader('Content-Type', 'application/json')
    let value
    if (req.url.includes('/assets?')) value = fault === 'missing-evidence' ? [] : [{ id: 1, name: 'release.json', state: 'uploaded' },
      ...(fault.startsWith('refresh-') ? [{ id: 2, name: 'verification-2-1.json', state: 'uploaded' }] : [])]
    else if (req.url.includes('/assets/2')) {
      value = structuredClone(record)
      value.verification.finishedAt = new Date().toISOString()
      if (fault === 'refresh-digest') value.images.viewer = value.images.viewer.replace(/d{64}/, 'e'.repeat(64))
      if (fault === 'refresh-policy') value.format = 1
    } else if (req.url.includes('/assets/1')) value = record
    else if (req.url.includes('/git/ref/')) value = { object: { type: 'tag', sha: fault === 'moved-tag' ? 'e'.repeat(40) : record.tagObject } }
    else if (req.url.includes('/git/tags/')) value = { object: { type: 'commit', sha: record.commit } }
    else if (req.url.includes('/actions/')) {
      if (fault === 'missing-workflow') res.statusCode = 404
      value = { id: 1, run_attempt: 1, status: 'completed', conclusion: fault === 'failed-workflow' ? 'failure' : 'success',
        head_sha: fault === 'workflow-source' ? 'e'.repeat(40) : record.commit,
        path: '.github/workflows/release.yml', repository: { full_name: record.repository } }
    } else {
      if (fault === 'unpublished') res.statusCode = 404
      value = { id: 1, tag_name: record.tag, draft: fault === 'revoked' }
    }
    res.end(JSON.stringify(value))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  vi.stubEnv('GITHUB_REPOSITORY', record.repository)
  vi.stubEnv('GITHUB_API_URL', `http://127.0.0.1:${server.address().port}`)
  vi.stubEnv('GITHUB_TOKEN', 'fixture-token')
  try { await run(record, requests) }
  finally { await new Promise(resolve => server.close(resolve)) }
}

it('accepts durable evidence older than 24 hours only with its successful workflow', async () => {
  await fixture('', async (record, requests) => {
    expect(await selectedRelease(record.tag)).toEqual(record)
    expect(requests).toContain('/repos/owner/viewer/actions/runs/1/attempts/1')
  })
})

it('retains the legacy expiry rule', async () => {
  await fixture('legacy', async record => {
    await expect(selectedRelease(record.tag)).rejects.toThrow('older than 24 hours')
  })
})

it.each(['unknown-format', 'future', 'invalid-date', 'source', 'missing-check', 'failed-check',
  'missing-evidence', 'refresh-digest', 'refresh-policy', 'moved-tag', 'missing-workflow',
  'failed-workflow', 'workflow-source', 'unpublished', 'revoked'])('rejects %s despite durable evidence', async fault => {
  await fixture(fault, async record => { await expect(selectedRelease(record.tag)).rejects.toThrow() })
})
