import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkChatProxy } from './check-chat-proxy.mjs'

const directory = mkdtempSync(join(tmpdir(), 'chat-compose-'))
process.on('exit', () => rmSync(directory, {recursive: true, force: true}))
copyFileSync('deploy/oracle/docker-compose.yml', join(directory, 'compose.yml'))
mkdirSync(join(directory, 'secrets'))
for (const file of ['caddy.env', 'oci-usage.env', 'discord.env']) writeFileSync(join(directory, 'secrets', file), '')

const environment = {...process.env, PUBLIC_HOSTNAME: 'chat-check.example.test',
  MEDIAMTX_AUTH_SECRET: 'm'.repeat(32), INTERNAL_AUTH_SECRET: 'i'.repeat(32),
  BETTER_AUTH_SECRET: 'b'.repeat(32), CHAT_TAG_HMAC_SECRET: 't'.repeat(32),
  CENTRIFUGO_TOKEN_HMAC_SECRET: 'c'.repeat(32), CENTRIFUGO_API_KEY: 'a'.repeat(32)}
for (const enabled of ['false', 'true']) {
  const result = JSON.parse(execFileSync('docker', ['compose', '-f', join(directory, 'compose.yml'),
    'config', '--no-env-resolution', '--format', 'json'],
  {env: {...environment, CHAT_ENABLED: enabled}, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}))
  const {centrifugo, viewer} = result.services
  if (viewer.environment.CHAT_ENABLED !== enabled || centrifugo.ports?.length ||
      !/^centrifugo\/centrifugo:v\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/.test(centrifugo.image) ||
      !centrifugo.healthcheck || viewer.depends_on?.centrifugo)
    throw new Error('Invalid Chat deployment configuration')
}
const defaults = {...environment}
delete defaults.CHAT_ENABLED
const result = JSON.parse(execFileSync('docker', ['compose', '-f', join(directory, 'compose.yml'),
  'config', '--no-env-resolution', '--format', 'json'], {env: defaults, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}))
if (result.services.viewer.environment.CHAT_ENABLED !== 'false') throw new Error('Chat must default to disabled')
console.log('Production Compose validates with Chat disabled, enabled, and disabled by default.')
await checkChatProxy()
