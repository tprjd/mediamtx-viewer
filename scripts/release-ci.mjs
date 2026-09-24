import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { identifyRelease, createReleaseRecord, refreshReleaseRecord, validateChecks } from './release.mjs'
import { sourceFingerprint } from './chat-capacity/source.mjs'
import { githubReleaseClient } from './release-publication.mjs'
import { buildImages, pushImages, verifyImages } from './release-images.mjs'

const repository = process.env.GITHUB_REPOSITORY?.toLowerCase()
const mode = process.env.RELEASE_MODE
const tag = process.env.RELEASE_TAG
const token = process.env.GITHUB_TOKEN
const output = '.data/release'

const { request: api, downloadRecord, uploadRecord } = githubReleaseClient()

try {
  if (process.env.GITHUB_ACTIONS !== 'true' || !token || !/^[a-z0-9-]+\/[a-z0-9._-]+$/.test(repository ?? '') || !['validation', 'publish', 'refresh'].includes(mode)) {
    throw new Error('Run this command from the release workflow')
  }
  if ((await api('')).private || process.arch !== 'arm64' || process.platform !== 'linux') throw new Error('Release verification requires the public repository and a standard Linux ARM64 runner')
  mkdirSync(output, { recursive: true })
  const identity = mode === 'validation'
    ? { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), version: JSON.parse(readFileSync('package.json', 'utf8')).version }
    : identifyRelease(tag)
  if (mode !== 'validation' && process.env.GITHUB_SHA !== identity.commit) throw new Error('Run the workflow from the selected release tag')
  identity.sourceFingerprint = sourceFingerprint()
  identity.repositoryUrl = `https://github.com/${repository}`

  let release = mode === 'validation' ? null : await api(`/releases/tags/${tag}`, { optional: true })
  const previous = await downloadRecord(release)
  if (mode === 'refresh' && !previous) throw new Error('Refresh requires an existing published release record')
  if (previous && (previous.commit !== identity.commit || previous.tagObject !== identity.tagObject || previous.sourceFingerprint !== identity.sourceFingerprint)) throw new Error('Published release identity changed')

  const checks = JSON.parse(readFileSync(`${output}/checks.json`, 'utf8'))
  validateChecks(checks, identity.sourceFingerprint)

  let references = previous?.images
  if (!references) {
    const suffix = `build-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
    const built = buildImages(`ghcr.io/${repository}`, suffix, identity)
    await verifyImages(built.references, identity, { canary: built.canary })
    references = pushImages(built.references)
  }
  const images = await verifyImages(references, identity, { anonymous: true })
  writeFileSync(`${output}/images.json`, JSON.stringify(images, null, 2) + '\n')

  if (mode === 'validation') {
    writeFileSync(`${output}/validation.json`, JSON.stringify({ deployable: false, ...identity, images, checks }, null, 2) + '\n')
    console.log('Hosted validation passed. No deployable release was created.')
  } else {
    const remoteTag = await api(`/git/ref/tags/${tag}`)
    if (remoteTag.object.type !== 'tag' || remoteTag.object.sha !== identity.tagObject) throw new Error('Remote release tag changed during verification')
    const record = previous ? refreshReleaseRecord(previous, checks, images) : createReleaseRecord(tag, checks, images)
    if (!release) release = await api('/releases', { method: 'POST', body: { tag_name: tag, target_commitish: identity.commit, name: tag, draft: true, generate_release_notes: false } })
    const name = previous ? `verification-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}.json` : 'release.json'
    writeFileSync(`${output}/${name}`, JSON.stringify(record, null, 2) + '\n')
    await uploadRecord(release.id, name, record)
    if (release.draft) await api(`/releases/${release.id}`, { method: 'PATCH', body: { draft: false, make_latest: 'false' } })
    console.log(`Verified ${tag}; release evidence: ${name}`)
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
