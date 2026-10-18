// @vitest-environment node
import { expect, it } from 'vitest'
import { stagingFixture } from './fixtures/staging-setup.mjs'

it('recovers the original attempt after loss before workstation acknowledgement', async () => {
  await stagingFixture(async ({ command, fault, url }) => {
    fault('interrupt-transfer')
    expect((await command('managed')).status).not.toBe(0)
    const status = await command('status')
    expect(status.status).not.toBe(0)
    const report = JSON.parse(status.stdout)
    expect(report).toMatchObject({ result: 'interrupted', owner: 'abandoned', phase: 'maintenance-backup' })
    expect(report.backup.attempt).toBeTruthy()
    expect(report.backup.acknowledged).toBe(false)
    expect((await fetch(url)).status).toBe(503)
    expect((await command('managed')).status).not.toBe(0)
    fault('')
    const recovered = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(recovered.status, recovered.stderr + recovered.diagnostic).toBe(0)
    expect(JSON.parse(recovered.stdout)).toMatchObject({ attempt: report.attempt, result: 'recovered' })
    expect((await fetch(url)).status).toBe(200)
  }, { managed: true })
}, 240000)

it.each(['interrupt-staging', 'interrupt-maintenance', 'interrupt-rollback'])('recovers the previous release after %s', async failure => {
  await stagingFixture(async ({ command, fault, url }) => {
    fault(failure)
    expect((await command('managed')).status).not.toBe(0)
    const report = JSON.parse((await command('status')).stdout)
    expect(report.owner).toBe('abandoned')
    fault('')
    const recovered = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(recovered.status, recovered.stderr + recovered.diagnostic).toBe(0)
    expect(JSON.parse(recovered.stdout)).toMatchObject({ attempt: report.attempt, result: 'recovered', version: 'fixture' })
    expect((await fetch(url)).status).toBe(200)
  }, { managed: true })
}, 240000)

it('allows a new deployment after a completed automatic rollback', async () => {
  await stagingFixture(async ({ command, fault }) => {
    fault('activation-failure')
    const failed = await command('managed')
    expect(JSON.parse(failed.stderr)).toMatchObject({ result: 'failed-rolled-back' })
    fault('')
    const next = await command('managed')
    expect(next.status, next.stderr + next.diagnostic).toBe(0)
    expect(JSON.parse(next.stdout).attempt).not.toBe(JSON.parse(failed.stderr).attempt)
  }, { managed: true })
}, 240000)

it('recovers an attempt interrupted before host tool initialization', async () => {
  await stagingFixture(async ({ command, fault, url }) => {
    fault('interrupt-owner-creation')
    expect((await command('managed')).status).not.toBe(0)
    const report = JSON.parse((await command('status')).stdout)
    expect(report.attempt).toBeTruthy()
    expect(report.owner).toBe('abandoned')
    fault('')
    const recovered = await command('recover', {}, ['--release', 'previous', '--restore', 'none'])
    expect(recovered.status, recovered.stderr + recovered.diagnostic).toBe(0)
    expect(JSON.parse(recovered.stdout)).toMatchObject({ attempt: report.attempt, result: 'recovered' })
    expect((await fetch(url)).status).toBe(200)
  }, { managed: true })
}, 240000)
