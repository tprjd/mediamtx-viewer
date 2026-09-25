// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, it } from 'vitest'
import { stagingFixture, docker, inspect } from './fixtures/staging-setup.mjs'

async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

it('keeps maintenance and suppresses migration startup after an isolated host restart', async () => {
  const endpoint = process.env.DOCKER_HOST ?? JSON.parse(docker('context', 'inspect'))[0].Endpoints.docker.Host
  const outer = (...args) => execFileSync('docker', ['--host', endpoint, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const daemon = `deployment-restart-${randomUUID()}`
  const port = await freePort(), webPort = await freePort()
  const saved = Object.fromEntries(['DOCKER_HOST', 'DEPLOY_FIXTURE_PORT', 'DEPLOY_FIXTURE_URL'].map(key => [key, process.env[key]]))
  async function ready() {
    for (let n = 0; n < 120; n++) {
      try { docker('info'); return } catch { await delay(500) }
    }
    throw new Error('Isolated Docker host did not start')
  }
  try {
    outer('run', '-d', '--privileged', '--tmpfs', '/run', '--name', daemon, '-e', 'DOCKER_TLS_CERTDIR=',
      '-p', `127.0.0.1:${port}:2375`, '-p', `127.0.0.1:${webPort}:18080`, 'docker:27.3.1-dind', '--tls=false')
    process.env.DOCKER_HOST = `tcp://127.0.0.1:${port}`
    process.env.DEPLOY_FIXTURE_PORT = '18080'
    process.env.DEPLOY_FIXTURE_URL = `http://127.0.0.1:${webPort}`
    await ready()
    for (const image of ['caddy:2.11.4-alpine', 'bluenviron/mediamtx:1.20.1']) docker('pull', image)
    await stagingFixture(async ({ command, fault, url, viewer }) => {
      fault('interrupt-chat')
      expect((await command('managed')).status).not.toBe(0)
      const before = JSON.parse((await command('status')).stdout)
      expect(before).toMatchObject({ phase: 'migration-chat', owner: 'abandoned' })
      outer('restart', '-t', '1', daemon)
      await ready()
      for (let n = 0; n < 100; n++) {
        try { if ((await fetch(url)).status === 503) break } catch {}
        await delay(100)
      }
      expect((await fetch(url)).status).toBe(503)
      expect(inspect(viewer).State.Running).toBe(false)
      const status = await command('status')
      expect(status.status).not.toBe(0)
      expect(JSON.parse(status.stdout)).toMatchObject({ attempt: before.attempt, owner: 'abandoned', observedMigrations: before.observedMigrations })
      expect((await command('managed')).status).not.toBe(0)
      fault('')
      const recovered = await command('recover', {}, ['--release', 'candidate', '--restore', 'none'])
      expect(recovered.status, recovered.stderr + recovered.diagnostic).toBe(0)
      expect(JSON.parse(recovered.stdout)).toMatchObject({ attempt: before.attempt, result: 'recovered' })
      expect((await fetch(url)).status).toBe(200)
    }, { managed: true, migrations: {
      'migrations/900_restart.sql': 'CREATE TABLE restart_auth (id INTEGER PRIMARY KEY); INSERT INTO restart_auth VALUES (1);',
      'chat-migrations/900_restart.sql': 'CREATE TABLE restart_chat (id INTEGER PRIMARY KEY); INSERT INTO restart_chat VALUES (1);',
    } })
  } catch (error) {
    try { execFileSync('docker', ['--host', endpoint, 'logs', '--tail', '100', daemon], { stdio: 'inherit' }) } catch {}
    throw error
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value
    try { outer('rm', '-f', '-v', daemon) } catch {}
  }
}, 600000)
