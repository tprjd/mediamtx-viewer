// @vitest-environment node
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { expect, it } from 'vitest'
import { requiredChecks } from './verification-checks.mjs'

const record = () => ({ format: 1, repository: 'tprjd/mediamtx-viewer', tag: 'v1.2.3', version: '1.2.3',
  commit: 'a'.repeat(40), tagObject: 'b'.repeat(40), sourceFingerprint: 'c'.repeat(64),
  images: Object.fromEntries(['viewer', 'thumbnailer'].map(name => [name, `ghcr.io/tprjd/mediamtx-viewer/${name}@sha256:${'d'.repeat(64)}`])),
  verification: { version: 1, passed: true, sourceFingerprint: 'c'.repeat(64), finishedAt: new Date(Date.now() - 86401000).toISOString(),
    runId: '1', runAttempt: '1', checks: requiredChecks.map(name => ({ name, passed: true })) } })

function command(args, env) {
  return new Promise(resolve => {
    const child = spawn('sh', ['deploy/oracle/deploy.sh', ...args], { env: { ...process.env, ...env } })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('close', status => resolve({ status, stdout, stderr }))
  })
}

it('rejects stale release evidence with a refresh action before contacting the target', async () => {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    const path = request.url
    response.end(JSON.stringify(path.includes('/assets/1') ? record() : path.includes('/assets?') ? [{ id: 1, name: 'release.json', state: 'uploaded' }]
      : path.includes('/git/ref/') ? { object: { type: 'tag', sha: 'b'.repeat(40) } }
      : path.includes('/git/tags/') ? { object: { type: 'commit', sha: 'a'.repeat(40) } }
      : path.includes('/actions/') ? { id: 1, run_attempt: 1, status: 'completed', conclusion: 'success', head_sha: 'a'.repeat(40), path: '.github/workflows/release.yml', repository: { full_name: 'tprjd/mediamtx-viewer' } }
      : { id: 1, tag_name: 'v1.2.3', draft: false }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await command(['prepare', 'unreachable.invalid', 'v1.2.3'], { GITHUB_API_URL: `http://127.0.0.1:${server.address().port}` })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('refresh')
    expect(result.stderr).toContain('24 hours')
  } finally { await new Promise(resolve => server.close(resolve)) }
})

const { stagingFixture, inspect, docker } = await import('./fixtures/staging-setup.mjs')
const runningIdentities = project => docker('ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`).split('\n').filter(Boolean).map(id => {
  const container = inspect(id)
  return { id, image: container.Image, startedAt: container.State.StartedAt, running: container.State.Running, paused: container.State.Paused }
}).sort((a, b) => a.id.localeCompare(b.id))
it.each([false, true])('stages the committed release privately with Chat=%s while services and data remain available', async chat => {
  await stagingFixture(async ({ command, viewer, source, project, image, fault }) => {
    const before = inspect(viewer)
    const allBefore = runningIdentities(project)
    docker('create', '--name', `${project}-stage-operation`, '--label', `org.frankerzspam.staging=${project}`,
      '--label', 'org.frankerzspam.staging-state={"attempt":"disconnected-before-save","release":"v1.2.3","images":{"viewer":"fixture-digest"}}', image)
    const interrupted = await command('status')
    expect(interrupted.status, interrupted.stderr).not.toBe(0)
    expect(JSON.parse(interrupted.stdout)).toMatchObject({ attempt: 'disconnected-before-save', release: 'v1.2.3', images: { viewer: 'fixture-digest' }, result: 'in-progress-or-interrupted' })
    docker('rm', `${project}-stage-operation`)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(`${source}/deploy/oracle/Caddyfile`, 'uncommitted invalid configuration')
    if (chat) fault('refresh-original-expired')
    const result = await command()
    expect(result.status, result.stderr + result.diagnostic).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ result: 'ready', release: 'v1.2.3', project, chatEnabled: chat })
    expect(inspect(viewer).Image).toBe(before.Image)
    expect(inspect(viewer).State.StartedAt).toBe(before.State.StartedAt)
    expect(inspect(viewer).State.Paused).toBe(false)
    expect(runningIdentities(project)).toEqual(allBefore)
    expect(JSON.parse(docker('exec', viewer, 'wget', '-qO-', 'http://127.0.0.1:3000/')).expired).toBe(1)
    expect(docker('exec', `${project}-caddy`, 'cat', '/etc/fixture.conf')).toBe('unchanged active configuration')
    const receipt = JSON.parse(result.stdout)
    const staged = JSON.parse(docker('run', '--rm', '--user', '0', '--network', 'none', '-v', `${receipt.stagingVolume}:/stage:ro`, '--entrypoint', 'node', image, '-e',
      `const fs=require('fs');const p='/stage/${receipt.attempt}/source';const m=JSON.parse(fs.readFileSync(p+'/resolved-compose.json'));console.log(JSON.stringify({mode:fs.statSync(p+'/deploy/oracle/secrets/caddy.env').mode&63,keyOwner:fs.statSync(p+'/deploy/oracle/secrets/oci-usage-api-key.pem').uid,project:m.name,image:m.services.viewer.image,volume:m.volumes.auth_data.name,build:!!m.services.viewer.build,caddy:fs.readFileSync(p+'/deploy/oracle/Caddyfile','utf8').includes('uncommitted')}))`))
    expect(staged).toMatchObject({ mode: 0, keyOwner: 1001, project, volume: `${project}_auth_data`, build: false, caddy: false, image: receipt.images.viewer })
    const stageRoot = JSON.parse(docker('volume', 'inspect', receipt.stagingVolume))[0].Mountpoint
    expect(docker('run', '--rm', '--network', 'none', '--mount', `type=bind,source=${stageRoot}/${receipt.attempt}/source/deploy/oracle/secrets/oci-usage-api-key.pem,target=/run/key,readonly`,
      '--entrypoint', 'node', image, '-e', 'require("fs").readFileSync("/run/key");console.log("readable")')).toBe('readable')
    expect(result.stdout + result.stderr).not.toContain('fixture-private')
    const status = await command('status')
    expect(status.status, status.stderr).toBe(0)
    expect(JSON.parse(status.stdout)).toMatchObject({ result: 'ready', release: 'v1.2.3' })
  }, { chat })
}, 240000)

it('rejects release, download, configuration, and storage failures before maintenance', async () => {
  await stagingFixture(async ({ command, viewer, directory, fault, project, image }) => {
    const before = inspect(viewer)
    const allBefore = runningIdentities(project)
    docker('create', '--name', `${project}-stage-operation`, '--label', `org.frankerzspam.staging=${project}`,
      '--label', 'org.frankerzspam.staging-state={"attempt":"disconnected-before-save","release":"v1.2.3","images":{"viewer":"fixture-digest"}}', image)
    const interrupted = await command('status')
    expect(interrupted.status, interrupted.stderr).not.toBe(0)
    expect(JSON.parse(interrupted.stdout)).toMatchObject({ attempt: 'disconnected-before-save', release: 'v1.2.3', images: { viewer: 'fixture-digest' }, result: 'in-progress-or-interrupted' })
    docker('rm', `${project}-stage-operation`)
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const hook = join(directory, 'full-disk.mjs')
    writeFileSync(hook, `import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const original=fs.statfsSync;
fs.statfsSync=(path,...args)=>String(path).includes('/copies')?{bsize:4096,bavail:0,files:1000,ffree:0}:original(path,...args);
syncBuiltinESMExports();`)
    for (const failure of ['stale', 'refresh-digest', 'checks', 'tag', 'version', 'digest', 'architecture', 'registry', 'configuration', 'host-architecture', 'volume-swap', 'host-space', 'workstation-space']) {
      fault(failure)
      const result = await command('prepare', failure === 'workstation-space' ? { NODE_OPTIONS: `--import=${hook}` } : {})
      expect(result.status, failure).not.toBe(0)
      const reasons = { stale: '24 hours', checks: '24 hours', tag: 'moved', version: 'Invalid release identity', digest: 'Image digest', architecture: 'Image architecture', registry: 'Docker operation failed',
        configuration: 'Streaming contract', 'host-architecture': 'Linux ARM64', 'volume-swap': 'volume identity', 'host-space': 'Host bytes', 'workstation-space': 'Workstation bytes', 'refresh-digest': 'Refreshed image digest' }
      expect(JSON.parse(result.stderr).reason, failure).toContain(reasons[failure])
      expect(runningIdentities(project), failure).toEqual(allBefore)
      if (!['stale', 'refresh-digest', 'checks', 'tag', 'version'].includes(failure)) expect(JSON.parse(result.stderr)).toMatchObject({ release: 'v1.2.3', images: { viewer: expect.stringContaining('@sha256:') }, result: 'rejected' })
      expect(result.stdout + result.stderr, failure).not.toContain('fixture-private')
      const current = inspect(viewer)
      expect(current.Image, failure).toBe(before.Image)
      expect(current.State.StartedAt, failure).toBe(before.State.StartedAt)
      expect(current.State.Paused, failure).toBe(false)
      expect(JSON.parse(docker('exec', viewer, 'wget', '-qO-', 'http://127.0.0.1:3000/')).expired, failure).toBe(1)
    }
    fault('')
    // A host-side owner blocks another client even if the original client disconnects.
    docker('create', '--name', `${project}-stage-operation`, '--label', `org.frankerzspam.staging=${project}`, image)
    const overlap = await command()
    expect(overlap.status).not.toBe(0)
    expect(overlap.stderr).toContain('lock')
    docker('rm', `${project}-stage-operation`)
    // A stopped required service is rejected without restarting it.
    docker('stop', '-t', '1', `${project}-mediamtx`)
    const stopped = await command()
    expect(stopped.status).not.toBe(0)
    expect(stopped.stderr).toContain('unhealthy')
    expect(inspect(`${project}-mediamtx`).State.Running).toBe(false)
  })
}, 240000)
