import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { docker, inspect, run } from './staging-setup.mjs'
import { runtimeIdentity } from '../deployment-state.mjs'
function proxyConfiguration(release) {
  return `:80 {\n header X-Fixture-Release ${release}\n @document {\n path /api/health\n header Sec-Fetch-Dest document\n }\n redir @document /login?returnTo=%2Fapi%2Fhealth 307\n respond /api/health 401\n reverse_proxy viewer:3000\n}\n`
}
export const key = Buffer.alloc(32, 12).toString('base64')

export async function prepareManagedSource({ source, directory, image, project, mediaPorts }) {
  for (const folder of ['migrations', 'chat-migrations']) cpSync(folder, join(source, folder), { recursive: true })
  const listener = createServer()
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = Number(process.env.DEPLOY_FIXTURE_PORT || listener.address().port)
  await new Promise(resolve => listener.close(resolve))
  writeFileSync(join(directory, 'port'), String(port))
  writeFileSync(join(source, 'deploy/oracle/Caddyfile'), proxyConfiguration('candidate'))
  const env = Object.fromEntries(['BETTER_AUTH_SECRET', 'INTERNAL_AUTH_SECRET', 'MEDIAMTX_AUTH_SECRET', 'CENTRIFUGO_API_KEY', 'CENTRIFUGO_TOKEN_HMAC_SECRET', 'CHAT_TAG_HMAC_SECRET'].map(key => [key, 'fixture-private-secret']))
  const idle = { image, stop_grace_period: '1s', command: ['node', '-e', 'setInterval(()=>{},1000)'] }
  const model = { name: project, services: {
    viewer: { image, stop_grace_period: '1s', entrypoint: ['node'], command: ['scripts/fixtures/maintenance/server.mjs'], environment: { ...env,
      AUTH_DB_PATH: '/data/auth.sqlite', CHAT_DB_PATH: '/data/chat.sqlite', AUTH_BACKUP_DIR: '/data/backups', CHAT_ENABLED: '${CHAT_ENABLED}',
      CHAT_DATABASE_LIMIT_BYTES: '2147483648', CHAT_MINIMUM_FREE_BYTES: '10737418240', FIXTURE_VERSION: '1.2.3' },
      volumes: ['auth_data:/data', 'thumbnail_data:/thumbnails'] },
    caddy: { image: 'caddy:2.11.4-alpine', environment: { PUBLIC_HOSTNAME: ':80', AUTH_BACKUP_KEY: key },
      ports: [`${process.env.DEPLOY_FIXTURE_PORT ? '0.0.0.0' : '127.0.0.1'}:${port}:80`], volumes: ['./Caddyfile:/etc/caddy/Caddyfile:ro', 'caddy_data:/data', 'caddy_config:/config'] },
    mediamtx: { image: 'bluenviron/mediamtx:1.20.1', volumes: ['./secrets/mediamtx.yml:/mediamtx.yml:ro'], environment: { MTX_UDPREADBUFFERSIZE: '0' } },
    'mediamtx-health': idle,
    thumbnailer: { ...idle, volumes: ['thumbnail_data:/thumbnails'] },
    centrifugo: { ...idle, healthcheck: { test: ['CMD', 'node', '-e', 'process.exit(0)'], interval: '1s', timeout: '1s', retries: 2 } },
    'discord-notifier': { ...idle, volumes: ['discord_notifier_state:/state', '../../scripts/discord-notifier.mjs:/app/discord-notifier.mjs:ro'] },
  }, volumes: Object.fromEntries(['auth_data', 'thumbnail_data', 'caddy_data', 'caddy_config', 'discord_notifier_state'].map(name => [name, {}])) }
  if (mediaPorts) {
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
    const mediaPort = listener.address().port
    await new Promise(resolve => listener.close(resolve))
    model.services.mediamtx.ports = [`127.0.0.1:${mediaPort}:1935`]
    model.services['mediamtx-health'] = { ...idle, healthcheck: {
      test: ['CMD', 'node', '-e', "const s=require('net').connect(1935,'mediamtx');s.setTimeout(1000);s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));s.on('timeout',()=>process.exit(1))"],
      interval: '10s', timeout: '2s', retries: 2,
    } }
  }
  writeFileSync(join(source, 'deploy/oracle/docker-compose.yml'), JSON.stringify(model))
}

export async function startManagedBaseline({ source, directory, image, project, chat, legacy = false, migrations: addedMigrations = {} }) {
  const ids = docker('ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`).split('\n')
  docker('rm', '-f', ...ids)
  const volume = `${project}-deployment-staging`
  docker('volume', 'create', volume)
  const tool = `${project}-baseline-tool`
  docker('run', '-d', '--name', tool, '--user', '0', '--label', `org.frankerzspam.staging=${project}`, '-v', `${volume}:/stage`, image, 'node', '-e', 'setInterval(()=>{},1000)')
  const previous = join(directory, 'previous')
  cpSync(source, previous, { recursive: true })
  for (const path of Object.keys(addedMigrations)) rmSync(join(previous, path))
  mkdirSync(join(previous, 'deploy/oracle/secrets'), { recursive: true })
  cpSync('deploy/oracle/mediamtx.yml.example', join(previous, 'deploy/oracle/secrets/mediamtx.yml'))
  writeFileSync(join(previous, 'scripts/discord-notifier.mjs'), '// previous mounted notifier script\n')
  writeFileSync(join(previous, 'deploy/oracle/Caddyfile'), proxyConfiguration('previous'))
  const model = JSON.parse(run('docker', ['compose', '-p', project, '-f', join(previous, 'deploy/oracle/docker-compose.yml'), 'config', '--format', 'json'], { env: { ...process.env, CHAT_ENABLED: String(chat) } }))
  const baselineImage = `${project}:previous`
  writeFileSync(join(directory, 'previous.Dockerfile'), `FROM ${image}\nLABEL org.frankerzspam.fixture=previous\n`)
  docker('build', '-q', '-t', baselineImage, '-f', join(directory, 'previous.Dockerfile'), directory)
  for (const name of ['viewer', 'thumbnailer']) model.services[name].image = baselineImage
  const root = JSON.parse(docker('volume', 'inspect', volume))[0].Mountpoint
  for (const config of Object.values(model.services)) {
    config.image = inspectImage(config.image)
    config.restart = 'no'
    for (const mount of config.volumes ?? []) if (mount.type === 'bind') mount.source = `${root}/baseline/source${mount.source.slice(previous.length)}`
  }
  model.services.viewer.environment.FIXTURE_VERSION = 'fixture'
  // Managed application images have server.js. This fixture uses the same direct startup contract.
  model.services.viewer.entrypoint = ['node']
  model.services.viewer.command = ['server.js']
  for (const [name, definition] of Object.entries(model.volumes)) model.volumes[name] = { name: definition.name, external: true }
  writeFileSync(join(previous, 'resolved-compose.json'), JSON.stringify(model))
  docker('exec', tool, 'mkdir', '-p', '/stage/baseline/source')
  docker('cp', `${previous}/.`, `${tool}:/stage/baseline/source`)
  const path = join(directory, 'baseline.json')
  writeFileSync(path, JSON.stringify(model))
  docker('compose', '-p', project, '-f', path, 'up', '-d', '--no-build', '--pull', 'never', ...Object.keys(model.services).filter(name => chat || name !== 'centrifugo'))
  if (!chat) docker('compose', '-p', project, '-f', path, 'create', '--no-build', 'centrifugo')
  const url = process.env.DEPLOY_FIXTURE_URL || `http://127.0.0.1:${readFileSync(join(directory, 'port'), 'utf8')}`
  for (let n = 0; n < 200; n++) {
    try { if ((await fetch(`${url}/_fixture-health`)).ok && [undefined, 'healthy'].includes(inspect(`${project}-mediamtx-health-1`).State.Health?.Status)) break } catch {}
    await delay(100)
  }
  const runtime = Object.fromEntries(docker('ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`).split('\n').map(id => {
    const value = inspect(id)
    return [value.Config.Labels['com.docker.compose.service'], runtimeIdentity(value)]
  }))
  docker('cp', 'scripts/deployment-state.mjs', `${tool}:/app/deployment-state.mjs`)
  docker('cp', 'scripts/backup-operation.mjs', `${tool}:/app/backup-operation.mjs`)
  const tree = JSON.parse(docker('exec', tool, 'node', '/app/deployment-state.mjs', 'tree', JSON.stringify({ path: '/stage/baseline/source' }))).digest
  const migrations = JSON.parse(docker('exec', `${project}-viewer-1`, 'node', '-e', `const D=require('better-sqlite3'); console.log(JSON.stringify(Object.fromEntries(['auth','chat'].map(n=>{const d=new D('/data/'+n+'.sqlite',{readonly:true});const rows=d.prepare('SELECT name, applied_at FROM app_migration ORDER BY name').all();d.close();return [n,rows]}))))`))
  docker('exec', tool, 'node', '/app/deployment-state.mjs', 'save', JSON.stringify({ path: '/stage/current.json', value: {
    format: 1, result: 'active', version: 'fixture', source: '/stage/baseline/source', tree, model, runtime, migrations, chatEnabled: chat,
  } }))
  docker('rm', '-f', tool)
  if (legacy) {
    for (const config of Object.values(model.services)) {
      config.restart = 'unless-stopped'
      for (const mount of config.volumes ?? []) if (mount.type === 'bind') mount.source = mount.source.replace(`${root}/baseline/source`, previous)
    }
    model.services.viewer.entrypoint = ['sh', '-c']
    model.services.viewer.command = ['node scripts/migrate.mjs && node scripts/migrate-chat.mjs && exec node server.js']
    writeFileSync(path, JSON.stringify(model))
    docker('compose', '-p', project, '-f', path, 'up', '-d', '--no-build', '--pull', 'never', '--wait', ...Object.keys(model.services).filter(name => chat || name !== 'centrifugo'))
    if (!chat) docker('compose', '-p', project, '-f', path, 'create', '--no-build', '--pull', 'never', 'centrifugo')
    docker('volume', 'rm', volume)
  }
  return { url, key }
}
function inspectImage(image) {
  try { return JSON.parse(docker('image', 'inspect', image))[0].Id }
  catch {
    // Fresh hosted runners do not have the external service images cached.
    docker('pull', image)
    return JSON.parse(docker('image', 'inspect', image))[0].Id
  }
}
