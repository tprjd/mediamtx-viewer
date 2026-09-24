// @vitest-environment node
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execute = promisify(execFile)
const command = resolve('scripts/release-publication.mjs')

async function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'publication-test-'))
  const record = { repository: 'owner/viewer', commit: 'a'.repeat(40), verification: { runId: '123', runAttempt: '2' } }
  const path = join(directory, 'record.json')
  writeFileSync(path, JSON.stringify(record))
  const requests = []
  let state = 'starter'
  let status = 'completed'
  let conclusion = 'success'
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`)
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'DELETE') { state = null; res.writeHead(204).end(); return }
    if (req.method === 'POST') { state = 'uploaded'; res.end(JSON.stringify({ state })); return }
    if (req.url.includes('/assets?per_page=')) { res.end(JSON.stringify(state ? [{ id: 7, name: 'release.json', state }] : [])); return }
    res.end(JSON.stringify({ id: 123, run_attempt: 2, status, conclusion, head_sha: record.commit, path: '.github/workflows/release.yml', repository: { full_name: record.repository } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const invoke = (...args) => execute(process.execPath, [command, ...args, path], { env: { ...process.env, GITHUB_REPOSITORY: record.repository, GITHUB_API_URL: base, GITHUB_UPLOAD_URL: base, GITHUB_TOKEN: 'fixture-token' } })
  try { await run({ invoke, requests, setState: value => { state = value }, setRun: (s, c) => { status = s; conclusion = c } }) }
  finally { await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }) }
}

it('removes an incomplete upload before retrying the release asset', async () => {
  await fixture(async ({ invoke, requests }) => {
    await invoke('upload', '5', 'release.json')
    expect(requests).toEqual(['GET /repos/owner/viewer/releases/5/assets?per_page=100&page=1', 'DELETE /repos/owner/viewer/releases/assets/7', 'POST /repos/owner/viewer/releases/5/assets?name=release.json'])
  })
})

it('never deletes or replaces an uploaded release record', async () => {
  await fixture(async ({ invoke, requests, setState }) => {
    setState('uploaded')
    await expect(invoke('upload', '5', 'release.json')).rejects.toThrow()
    expect(requests).toEqual(['GET /repos/owner/viewer/releases/5/assets?per_page=100&page=1'])
  })
})

it.each([['in_progress', null], ['completed', 'failure'], ['completed', 'cancelled']])('rejects evidence from a %s %s workflow attempt', async (status, conclusion) => {
  await fixture(async ({ invoke, setRun }) => {
    setRun(status, conclusion)
    await expect(invoke('ready')).rejects.toThrow()
  })
})

it('accepts evidence only after the exact workflow attempt succeeds', async () => {
  await fixture(async ({ invoke, requests }) => {
    await invoke('ready')
    expect(requests).toEqual(['GET /repos/owner/viewer/actions/runs/123/attempts/2'])
  })
})
