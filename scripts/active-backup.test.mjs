// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

it('selects active service identities on each job run and forwards the key only through the environment', () => {
  const directory = mkdtempSync(join(tmpdir(), 'active-backup-'))
  try {
    const executable = join(directory, 'docker'), calls = join(directory, 'calls')
    writeFileSync(executable, `#!/usr/bin/env node
const fs=require('fs'),args=process.argv.slice(2);
if(args[0]==='ps') {
 if(args.includes('name=^/mediamtx-viewer-deploy-operation$'))process.stdout.write(process.env.OWNER||'');
 else if(args.includes('label=com.docker.compose.service=viewer'))process.stdout.write(process.env.VIEWER);
 else process.stdout.write('c'.repeat(64));
} else if(args[0]==='inspect')process.stdout.write('AUTH_BACKUP_KEY='+Buffer.alloc(32,9).toString('base64')+'\\n');
else if(args[0]==='exec')fs.writeFileSync(process.env.CALLS,JSON.stringify({args,key:process.env.AUTH_BACKUP_KEY}));
else process.exit(1);
`); chmodSync(executable, 0o700)
    const run = (viewer, owner = '') => spawnSync('sh', [resolve('deploy/oracle/active-backup.sh')], { encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, VIEWER: viewer, OWNER: owner, CALLS: calls } })
    for (const viewer of ['a'.repeat(64), 'b'.repeat(64)]) {
      const result = run(viewer)
      expect(result.status, result.stderr).toBe(0)
      const recorded = JSON.parse(readFileSync(calls))
      expect(recorded.args).toEqual(['exec', '-e', 'AUTH_BACKUP_KEY', viewer, 'node', 'scripts/backup-auth.mjs'])
      expect(recorded.key).toBe(Buffer.alloc(32, 9).toString('base64'))
      expect(result.stdout).not.toContain(recorded.key)
    }
    expect(run('a'.repeat(64), 'held').status).not.toBe(0)
    expect(run('a'.repeat(64) + '\n' + 'b'.repeat(64)).status).not.toBe(0)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

it('rejects the retired unversioned deployment command before any host access', () => {
  const result = spawnSync('sh', ['deploy/oracle/deploy.sh', 'example.invalid'], { encoding: 'utf8' })
  expect(result.status).toBe(2)
  expect(result.stderr).toContain('VM builds are retired')
})

it('installs the stable launcher and replaces only the application backup service in an isolated host fixture', async () => {
  const { hostJobFixture } = await import('./fixtures/host-jobs.mjs')
  const { installOperationalJobs } = await import('./install-operational-jobs.mjs')
  const directory = mkdtempSync(join(tmpdir(), 'host-jobs-')), bin = join(directory, 'bin')
  const originalPath = process.env.PATH
  try {
    mkdirSync(bin)
    const root = hostJobFixture(directory, bin)
    process.env.PATH = `${bin}:${originalPath}`
    await installOperationalJobs('local', 'fixture')
    expect(readFileSync(join(root, 'usr/local/libexec/mediamtx-active-backup'), 'utf8')).toBe(readFileSync('deploy/oracle/active-backup.sh', 'utf8'))
    expect(readFileSync(join(root, 'etc/systemd/system/mediamtx-backup.service'), 'utf8')).toContain('mediamtx-active-backup fixture')
    expect(readFileSync(join(root, 'var/lib/mediamtx-deployment/legacy-backup.service'), 'utf8')).toContain('/old/checkout/backup')
  } finally { process.env.PATH = originalPath; rmSync(directory, { recursive: true, force: true }) }
})
