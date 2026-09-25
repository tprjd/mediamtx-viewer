// @vitest-environment node
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, it } from 'vitest'
import { stagingFixture, docker } from './fixtures/staging-setup.mjs'

it('does not steal an active deployment or let a scheduled backup remove its files', async () => {
  await stagingFixture(async ({ command, fault, directory, url }) => {
    fault('pause-transfer')
    const pending = command('managed')
    try {
      for (let n = 0; n < 600 && !existsSync(join(directory, 'paused')); n++) await delay(100)
      expect(existsSync(join(directory, 'paused'))).toBe(true)
      const status = await command('status')
      expect(status.status).not.toBe(0)
      const report = JSON.parse(status.stdout)
      expect(report.owner).toBe('active')
      expect((await command('recover', {}, ['--release', 'previous', '--restore', 'none'])).status).not.toBe(0)
      expect((await command('managed')).status).not.toBe(0)
      expect((await command('prepare')).status).not.toBe(0)
      expect((await command('chat-enable')).status).not.toBe(0)
      expect((await command('chat-disable')).status).not.toBe(0)
      expect(() => docker('exec', `maintenance-tool-${report.backup.attempt}`, 'node', '/app/scripts/backup-auth.mjs')).toThrow()
      expect(JSON.parse((await command('status')).stdout)).toMatchObject({ attempt: report.attempt, owner: 'active' })
      expect((await fetch(url)).status).toBe(503)
    } finally { fault('') }
    const result = await pending
    expect(result.status, result.stderr + result.diagnostic).toBe(0)
  }, { managed: true })
}, 240000)

it('keeps the lock while an in-flight Docker client outlives the workstation process', async () => {
  await stagingFixture(async ({ command, fault }) => {
    fault('interrupt-inflight')
    let report
    try {
      expect((await command('managed')).status).not.toBe(0)
      report = JSON.parse((await command('status')).stdout)
      expect(report.owner).toBe('active')
      expect((await command('recover', {}, ['--release', 'previous', '--restore', 'none'])).status).not.toBe(0)
    } finally { fault('') }
    for (let n = 0; n < 30; n++) {
      if (JSON.parse((await command('status')).stdout).owner === 'abandoned') break
      await delay(100)
    }
    const recovered = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(recovered.status, recovered.stderr + recovered.diagnostic).toBe(0)
    expect(JSON.parse(recovered.stdout).attempt).toBe(report.attempt)
  }, { managed: true })
}, 240000)
