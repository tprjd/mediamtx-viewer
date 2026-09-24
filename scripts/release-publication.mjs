import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function githubReleaseClient() {
  const repository = process.env.GITHUB_REPOSITORY?.toLowerCase()
  if (!/^[a-z0-9-]+\/[a-z0-9._-]+$/.test(repository ?? '')) throw new Error('Missing GitHub repository identity')
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const base = process.env.GITHUB_API_URL || 'https://api.github.com'
  async function request(path, { method = 'GET', body, optional = false, upload = false, binary = false } = {}) {
    const origin = upload ? process.env.GITHUB_UPLOAD_URL || 'https://uploads.github.com' : base
    const response = await fetch(`${origin}/repos/${repository}${path}`, {
      method, headers: { ...headers, 'Content-Type': 'application/json', ...(binary ? { Accept: 'application/octet-stream' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    })
    if (optional && response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub request failed (${response.status})`)
    return response.status === 204 ? null : response.json()
  }
  async function assets(releaseId) {
    const result = []
    for (let page = 1; ; page++) {
      const batch = await request(`/releases/${releaseId}/assets?per_page=100&page=${page}`)
      result.push(...batch)
      if (batch.length < 100) return result
    }
  }
  return {
    request,
    async downloadRecord(release) {
      if (!release) return null
      const asset = (await assets(release.id)).find(asset => asset.name === 'release.json' && asset.state === 'uploaded')
      return asset ? request(`/releases/assets/${asset.id}`, { binary: true }) : null
    },
    async uploadRecord(releaseId, name, record) {
      const previous = (await assets(releaseId)).find(asset => asset.name === name)
      if (previous?.state === 'uploaded') throw new Error('Release evidence already exists; refusing to replace it')
      if (previous) await request(`/releases/assets/${previous.id}`, { method: 'DELETE' })
      await request(`/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`, { method: 'POST', body: record, upload: true })
    },
    async requireSuccessfulWorkflow(record) {
      const { runId, runAttempt } = record.verification ?? {}
      if (record.repository !== repository || !/^[1-9]\d*$/.test(runId ?? '') || !/^[1-9]\d*$/.test(runAttempt ?? '')) throw new Error('Invalid workflow identity')
      const run = await request(`/actions/runs/${runId}/attempts/${runAttempt}`)
      if (String(run.id) !== String(runId) || String(run.run_attempt) !== String(runAttempt) || run.status !== 'completed' || run.conclusion !== 'success' ||
          run.head_sha !== record.commit || run.path !== '.github/workflows/release.yml' || run.repository?.full_name?.toLowerCase() !== repository) {
        throw new Error('Release workflow attempt has not completed successfully for this source')
      }
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [action, ...args] = process.argv.slice(2)
    const client = githubReleaseClient()
    if (action === 'upload') await client.uploadRecord(args[0], args[1], JSON.parse(readFileSync(args[2], 'utf8')))
    else if (action === 'ready') await client.requireSuccessfulWorkflow(JSON.parse(readFileSync(args[0], 'utf8')))
    else throw new Error('Usage: release-publication.mjs ready RECORD | upload RELEASE_ID NAME RECORD')
    console.log('Publication check passed')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
