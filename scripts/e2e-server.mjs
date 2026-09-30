import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { sourceFingerprint } from './chat-capacity/source.mjs'

const port = process.argv[2]
if (!['3199', '3299'].includes(port)) throw new Error('Select browser fixture port 3199 or 3299')
const dist = '.next-e2e'
const standalone = resolve(dist, 'standalone')
const marker = join(dist, '.verification-build.json')
const identity = `${process.platform}-${process.arch}-${process.versions.node}-${sourceFingerprint()}`
const env = { ...process.env, NODE_ENV: 'production', NEXT_DIST_DIR: dist,
  NEXT_PUBLIC_CENTRIFUGO_WEBSOCKET_URL: 'ws://127.0.0.1:3800/connection/websocket',
  NEXT_TELEMETRY_DISABLED: '1' }
for (const key of ['AUTH_DB_PATH', 'CHAT_DB_PATH']) if (env[key]) env[key] = resolve(env[key])

// Playwright starts these web servers in order. The first prepares one immutable
// production build; both processes use separate fixture database paths.
if (!existsSync(marker) || readFileSync(marker, 'utf8') !== identity || !existsSync(join(standalone, 'server.js'))) {
  if (port !== '3199') throw new Error('Start the primary browser fixture before the Chat fixture')
  execFileSync(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack'], { env, stdio: ['ignore', 2, 2] })
  for (const directory of ['public', 'scripts', 'migrations', 'chat-migrations']) {
    cpSync(directory, join(standalone, directory), { recursive: true })
  }
  mkdirSync(join(standalone, dist), { recursive: true })
  cpSync(join(dist, 'static'), join(standalone, dist, 'static'), { recursive: true })
  // Match the explicit dependency copied into the release image.
  cpSync('node_modules/@better-auth/utils', join(standalone, 'node_modules/@better-auth/utils'), { recursive: true })
  writeFileSync(marker, identity)
}

const child = spawn(process.execPath, [join(standalone, 'server.js')], {
  env: { ...env, HOSTNAME: '::1', PORT: port }, stdio: 'inherit',
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', code => { process.exitCode = code ?? 1 })
