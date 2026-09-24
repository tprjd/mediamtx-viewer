import { githubReleaseClient } from './release-publication.mjs'
import { validateChecks } from './release.mjs'

export async function selectedRelease(tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error('Select a vX.Y.Z release tag')
  process.env.GITHUB_REPOSITORY ??= 'tprjd/mediamtx-viewer'
  const client = githubReleaseClient()
  const release = await client.request(`/releases/tags/${tag}`)
  if (release.draft || release.tag_name !== tag) throw new Error('Release is not published')
  const original = await client.downloadRecord(release)
  const repository = process.env.GITHUB_REPOSITORY.toLowerCase()
  if (original?.format !== 1 || original.tag !== tag || `v${original.version}` !== tag || original.repository !== repository ||
      !/^[a-f0-9]{40}$/.test(original.commit ?? '') || !/^[a-f0-9]{40}$/.test(original.tagObject ?? '') ||
      !/^[a-f0-9]{64}$/.test(original.sourceFingerprint ?? '')) throw new Error('Invalid release identity')
  for (const name of ['viewer', 'thumbnailer']) {
    const prefix = `ghcr.io/${repository}/${name}@sha256:`
    const ref = original.images?.[name]
    if (!ref?.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(ref.slice(prefix.length))) throw new Error('Missing exact application image digest')
  }
  const remote = await client.request(`/git/ref/tags/${tag}`)
  const annotated = await client.request(`/git/tags/${original.tagObject}`)
  if (remote.object?.type !== 'tag' || remote.object.sha !== original.tagObject ||
      annotated.object?.type !== 'commit' || annotated.object.sha !== original.commit) throw new Error('Release tag moved or commit mismatched')
  const records = [original]
  for (let page = 1; ; page++) {
    const assets = await client.request(`/releases/${release.id}/assets?per_page=100&page=${page}`)
    for (const asset of assets.filter(asset => /^verification-\d+-\d+\.json$/.test(asset.name) && asset.state === 'uploaded')) {
      const next = await client.request(`/releases/assets/${asset.id}`, { binary: true })
      for (const key of ['format', 'tag', 'version', 'repository', 'commit', 'tagObject', 'sourceFingerprint']) {
        if (original[key] !== next[key]) throw new Error('Refreshed release identity changed')
      }
      if (['viewer', 'thumbnailer'].some(name => original.images[name] !== next.images?.[name])) throw new Error('Refreshed image digest changed')
      records.push(next)
    }
    if (assets.length < 100) break
  }
  for (const record of records.sort((a, b) => Date.parse(b.verification?.finishedAt) - Date.parse(a.verification?.finishedAt))) {
    try { validateChecks(record.verification, original.sourceFingerprint) } catch { continue }
    await client.requireSuccessfulWorkflow(record)
    return record
  }
  throw new Error('Required verification is incomplete or older than 24 hours. Run Verified ARM64 release in refresh mode from the selected tag; do not rebuild or replace its images.')
}
