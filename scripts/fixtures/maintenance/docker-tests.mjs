import { execFileSync, spawnSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { beforeAll, describe, expect, it } from 'vitest'

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const image = 'mediamtx-maintenance-fixture:local'
const request = (url, options = {}) => fetch(url, { ...options, headers: { Connection: 'close' } })
const key = Buffer.alloc(32, 12).toString('base64')
const inspect = name => JSON.parse(docker('inspect', name))[0]
const command = (args, env = {}) => spawnSync(process.execPath, ['scripts/maintenance-backup.mjs', ...args], {
  encoding: 'utf8', timeout: 120000, env: { ...process.env, AUTH_BACKUP_KEY: key, ...env },
})
async function fixture(chat, work, { smallDisk = false } = {}) {
  const project = `backup-${randomUUID()}`
  const directory = mkdtempSync(join(tmpdir(), 'maintenance-command-'))
  const viewer = `${project}-viewer`
  const caddy = `${project}-caddy`
  const broker = `${project}-centrifugo`
  const labels = service => ['--label', `com.docker.compose.project=${project}`, '--label', `com.docker.compose.service=${service}`]
  try {
    docker('network', 'create', project)
    docker('volume', 'create', ...(smallDisk ? ['--opt', 'type=tmpfs', '--opt', 'device=tmpfs', '--opt', 'o=size=32m'] : []), project)
    docker('run', '-d', '--name', viewer, ...labels('viewer'), '--network', project, '--network-alias', 'viewer',
      '-v', `${project}:/data`, '-e', 'AUTH_DB_PATH=/data/auth.sqlite', '-e', 'CHAT_DB_PATH=/data/chat.sqlite',
      '-e', 'AUTH_BACKUP_DIR=/data/backups', '-e', `CHAT_ENABLED=${chat}`, image)
    if (chat) docker('run', '-d', '--name', broker, ...labels('centrifugo'), image, 'node', '-e', 'setInterval(()=>{},1000)')
    writeFileSync(join(directory, 'Caddyfile'), ':80 {\n reverse_proxy viewer:3000\n}\n')
    const listener = createServer()
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
    const port = listener.address().port
    await new Promise(resolve => listener.close(resolve))
    docker('create', '--name', caddy, ...labels('caddy'), '--network', project, '-e', 'PUBLIC_HOSTNAME=:80', '-e', `AUTH_BACKUP_KEY=${key}`, '-p', `127.0.0.1:${port}:80`, '-v', `${join(directory, 'Caddyfile')}:/etc/caddy/Caddyfile:ro`, 'caddy:2.11.4-alpine')
    docker('start', caddy)
    const url = `http://127.0.0.1:${inspect(caddy).NetworkSettings.Ports['80/tcp'][0].HostPort}`
    for (let n = 0; n < 80; n++) {
      try { if ((await request(`${url}/api/health`)).ok) break } catch { /* starting */ }
      await delay(100)
    }
    expect((await request(`${url}/api/health`)).ok).toBe(true)
    await work({ project, directory, viewer, caddy, broker, url })
  } finally {
    const ids = docker('ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`).split('\n').filter(Boolean)
    for (const id of ids) { try { if (inspect(id).State.Paused) docker('unpause', id) } catch { /* removed */ } }
    if (ids.length) docker('rm', '-f', ...ids)
    docker('volume', 'rm', project)
    docker('network', 'rm', project)
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('maintenance backup command on an isolated Docker installation', () => {
  beforeAll(() => {
    const endpoint = process.env.DOCKER_HOST ?? JSON.parse(docker('context', 'inspect'))[0].Endpoints.docker.Host
    if (!endpoint.startsWith('unix://') && !/^tcp:\/\/(localhost|127\.0\.0\.1):/.test(endpoint)) throw new Error('Maintenance tests require a local Docker host, never an Oracle target')
    try { docker('info') } catch { throw new Error('Maintenance backup tests require a running Docker host') }
    docker('build', '-q', '-t', image, '-f', 'scripts/fixtures/maintenance/Dockerfile', '.')
  }, 240000)

  it.each([false, true])('verifies a private backup and resumes the same containers with Chat=%s', async chat => {
    await fixture(chat, async ({ project, directory, viewer, url }) => {
      const before = inspect(viewer)
      const result = command(['backup', '--project', project, '--directory', join(directory, 'copies'), '--url', url])
      expect(result.status, result.stderr).toBe(0)
      const receipt = JSON.parse(result.stdout)
      expect(receipt).toMatchObject({ result: 'complete', chatEnabled: chat })
      const { decryptDatabaseBackup } = await import('../../database-backups.mjs')
      const Database = (await import('better-sqlite3')).default
      const path = join(directory, 'chat.sqlite')
      await decryptDatabaseBackup(receipt.workstationManifest, 'chat', path, Buffer.from(key, 'base64'))
      const db = new Database(path)
      expect(db.prepare('SELECT count(*) AS n FROM chat_message').get().n).toBe(0)
      db.close()
      expect(inspect(viewer).Id).toBe(before.Id)
      expect(inspect(viewer).State.StartedAt).toBe(before.State.StartedAt)
      expect(inspect(viewer).State.Paused).toBe(false)
      expect(await (await request(url)).json()).toMatchObject({ expired: 1 })
      expect(await (await request(`${url}/api/health`)).json()).toMatchObject({ chat: { status: chat ? 'healthy' : 'disabled' } })
    })
  }, 120000)
  it('holds stopped writers, rejects overlap, protects deployment sets from daily rotation, and resumes explicitly', async () => {
    await fixture(false, async ({ project, directory, viewer, url }) => {
      const args = ['backup', '--project', project, '--directory', join(directory, 'copies'), '--url', url]
      const held = command([...args, '--hold'])
      expect(held.status, held.stderr).toBe(0)
      const receipt = JSON.parse(held.stdout)
      expect(receipt.result).toBe('verified-maintenance')
      expect(inspect(viewer).State.Paused).toBe(true)
      expect((await request(url, { method: 'POST' })).status).toBe(503)
      const helper = `maintenance-tool-${receipt.attempt}`
      const count = () => docker('exec', helper, 'node', '-e',
        "const D=require('better-sqlite3');const d=new D('/data/chat.sqlite',{readonly:true});console.log(d.prepare('SELECT count(*) AS n FROM fixture_writes').get().n);d.close()")
      const writes = count()
      await delay(400)
      expect(count()).toBe(writes)
      expect(command(args).status).not.toBe(0)
      const daily = spawnSync('docker', ['exec', helper, 'node', 'scripts/backup-auth.mjs'], { encoding: 'utf8' })
      expect(daily.status).not.toBe(0)
      const restore = spawnSync('docker', ['exec', '-e', 'AUTH_RESTORE_CONFIRM=replace', helper, 'node', 'scripts/restore-auth.mjs', receipt.hostManifest], { encoding: 'utf8' })
      expect(restore.status).not.toBe(0)
      const chatRestore = spawnSync('docker', ['exec', '-e', 'CHAT_RESTORE_CONFIRM=replace', '-e', 'INTERNAL_AUTH_SECRET=fixture-only', helper, 'node', 'scripts/restore-chat.mjs', receipt.hostManifest], { encoding: 'utf8' })
      expect(chatRestore.status).not.toBe(0)
      docker('exec', helper, 'node', '-e', "require('fs').rmSync('/data/backups/.backup-lock',{recursive:true})")
      expect(spawnSync('docker', ['exec', helper, 'node', 'scripts/backup-auth.mjs']).status).not.toBe(0)
      docker('exec', helper, 'node', '-e', "require('fs').mkdirSync('/data/backups/.backup-lock',{mode:0o700})")
      const resumed = command(['resume', '--project', project, '--attempt', receipt.attempt])
      expect(resumed.status, resumed.stderr).toBe(0)
      expect(inspect(viewer).State.Paused).toBe(false)
      // Two scheduled backups on the same day retain one daily set, without deleting the deployment set.
      for (let n = 0; n < 2; n++) docker('exec', '-e', `AUTH_BACKUP_KEY=${key}`, viewer, 'node', 'scripts/backup-auth.mjs')
      expect(docker('exec', viewer, 'node', '-e', `console.log(require('fs').existsSync(${JSON.stringify(receipt.hostManifest)}))`)).toBe('true')
      expect(docker('exec', viewer, 'node', '-e', "console.log(require('fs').readdirSync('/data/backups').length)")).toBe('1')
    })
  }, 120000)

  it('rejects missing and wrong keys and insufficient host space before maintenance', async () => {
    await fixture(false, async ({ project, directory, viewer, url }) => {
      for (const value of ['', Buffer.alloc(32, 99).toString('base64')]) {
        expect(command(['backup', '--project', project, '--directory', join(directory, 'copies'), '--url', url], { AUTH_BACKUP_KEY: value }).status).not.toBe(0)
        expect(inspect(viewer).State.Paused).toBe(false)
        expect((await request(url)).status).toBe(200)
      }
    })
    await fixture(false, async ({ project, directory, viewer, url }) => {
      expect(command(['backup', '--project', project, '--directory', join(directory, 'copies'), '--url', url]).status).not.toBe(0)
      expect(inspect(viewer).State.Paused).toBe(false)
      expect((await request(url)).status).toBe(200)
    }, { smallDisk: true })
  }, 120000)

  it('validates workstation copies and removes private plaintext after corrupt data or migration records', async () => {
    await fixture(false, async ({ project, directory, url }) => {
      const result = command(['backup', '--project', project, '--directory', join(directory, 'copies'), '--url', url])
      expect(result.status, result.stderr).toBe(0)
      const receipt = JSON.parse(result.stdout)
      const path = receipt.workstationManifest
      const set = join(directory, 'copies', receipt.attempt)
      expect(readdirSync(set).sort()).toEqual(['auth.sqlite.enc', 'chat.sqlite.enc', 'manifest.json'])
      expect(statSync(set).mode & 0o077).toBe(0)
      for (const file of readdirSync(set)) expect(statSync(join(set, file)).mode & 0o077).toBe(0)
      const verify = () => spawnSync(process.execPath, ['scripts/verify-backup.mjs', path], { env: { ...process.env, AUTH_BACKUP_KEY: key }, encoding: 'utf8' })
      expect(verify().status).toBe(0)
      const original = readFileSync(path)
      const manifest = JSON.parse(original)
      delete manifest.signature
      manifest.databases.chat.migrations = ['not-the-recorded-schema']
      manifest.signature = createHmac('sha256', Buffer.from(key, 'base64')).update(JSON.stringify(manifest)).digest('hex')
      writeFileSync(path, JSON.stringify(manifest))
      expect(verify().status).not.toBe(0)
      expect(readdirSync(set).some(name => name.startsWith('.verify-'))).toBe(false)
      writeFileSync(path, original)
      writeFileSync(join(set, 'chat.sqlite.enc'), 'damaged')
      expect(verify().status).not.toBe(0)
      expect(existsSync(join(set, 'chat.sqlite'))).toBe(false)
    })
  }, 120000)

  it.each(['transfer', 'corrupt', 'snapshot'])('fails on %s and resumes only the unchanged healthy release', async fault => {
    await fixture(false, async ({ project, directory, viewer, url }) => {
      const realDocker = execFileSync('which', ['docker'], { encoding: 'utf8' }).trim()
      const wrapper = join(directory, 'docker')
      writeFileSync(wrapper, `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const args = process.argv.slice(2);
const result = spawnSync(${JSON.stringify(realDocker)}, args, { stdio: 'inherit' });
if (result.status) process.exit(result.status);
const fault = ${JSON.stringify(fault)};
if (args[0] === 'cp' && args[1].includes('/deployment-backups/') && args[1].endsWith('chat.sqlite.enc')) {
  if (fault === 'transfer') process.exit(1);
  if (fault === 'corrupt') fs.writeFileSync(args[2], 'damaged transfer');
}
if (fault === 'snapshot' && args.includes('/app/scripts/maintenance-host.mjs') && args.includes('snapshot')) process.exit(1);
`, { mode: 0o700 })
      const result = command(['backup', '--project', project, '--directory', join(directory, 'copies'), '--url', url], { PATH: `${directory}:${process.env.PATH}` })
      expect(result.status).not.toBe(0)
      expect(JSON.parse(result.stderr)).toMatchObject({ result: 'failed-resumed' })
      expect(inspect(viewer).State.Paused).toBe(false)
      expect((await request(url)).status).toBe(200)
      expect(result.stdout).not.toContain('verified')
    })
  }, 120000)

  it('retains maintenance when enabled Chat fails its resume health check', async () => {
    await fixture(true, async ({ project, directory, viewer, url }) => {
      const held = command(['backup', '--project', project, '--directory', join(directory, 'copies'), '--url', url, '--hold'])
      expect(held.status, held.stderr).toBe(0)
      const receipt = JSON.parse(held.stdout)
      docker('exec', `maintenance-tool-${receipt.attempt}`, 'node', '-e', "require('fs').writeFileSync('/data/unhealthy','1')")
      const resumed = command(['resume', '--project', project, '--attempt', receipt.attempt])
      expect(resumed.status).not.toBe(0)
      expect(inspect(viewer).State.Paused).toBe(true)
      expect((await request(url)).status).toBe(503)
      expect(command(['backup', '--project', project, '--directory', join(directory, 'copies'), '--url', url]).status).not.toBe(0)
    })
  }, 120000)

  it('rejects insufficient workstation space without stopping the release', async () => {
    await fixture(false, async ({ project, directory, viewer, url }) => {
      const hook = join(directory, 'full-disk.mjs')
      writeFileSync(hook, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.statfsSync;
fs.statfsSync = (path, ...args) => path.includes('copies') ? { bsize: 4096, bavail: 0, files: 1000, ffree: 0 } : original(path, ...args);
syncBuiltinESMExports();
`)
      const result = command(['backup', '--project', project, '--directory', join(directory, 'copies'), '--url', url], { NODE_OPTIONS: `--import=${hook}` })
      expect(result.status).not.toBe(0)
      expect(inspect(viewer).State.Paused).toBe(false)
      expect((await request(url)).status).toBe(200)
    })
  }, 120000)

  it('keeps public writes closed when the proxy startup configuration changes during maintenance', async () => {
    await fixture(false, async ({ project, directory, viewer, caddy, url }) => {
      const startedAt = inspect(caddy).State.StartedAt
      const held = command(['backup', '--project', project, '--directory', join(directory, 'copies'), '--url', url, '--hold'])
      expect(held.status, held.stderr).toBe(0)
      const receipt = JSON.parse(held.stdout)
      writeFileSync(join(directory, 'Caddyfile'), ':80 {\n header X-Changed true\n reverse_proxy viewer:3000\n}\n')
      const resumed = command(['resume', '--project', project, '--attempt', receipt.attempt])
      expect(resumed.status).not.toBe(0)
      expect(JSON.parse(resumed.stderr).result).toBe('maintenance-retained')
      expect(inspect(viewer).State.Paused).toBe(true)
      expect(inspect(caddy).State.Running).toBe(false)
      expect(inspect(caddy).State.StartedAt).toBe(startedAt)
      expect((await request(url, { method: 'POST' })).status).toBe(503)
    })
  }, 120000)

})
