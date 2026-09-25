import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { requiredChecks } from '../verification-checks.mjs'
export const run = (bin, args, options = {}) => execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()
export const docker = (...args) => run('docker', args)
export const inspect = id => JSON.parse(docker('inspect', id))[0]

export async function stagingFixture(work, { chat = false, managed = false, mediaPorts = false, migrations = {} } = {}) {
  const endpoint = process.env.DOCKER_HOST ?? JSON.parse(docker('context', 'inspect'))[0].Endpoints.docker.Host
  if (!endpoint.startsWith('unix://') && !/^tcp:\/\/(localhost|127\.0\.0\.1):/.test(endpoint)) throw new Error('Staging tests require local Docker')
  docker('info')
  const directory = mkdtempSync(join(tmpdir(), 'stage-fixture-'))
  const project = `stage-test-${randomUUID()}`
  const image = `${project}:fixture`
  const source = join(directory, 'source')
  const volumes = ['auth_data', 'thumbnail_data', 'caddy_data', 'caddy_config', 'discord_notifier_state']
  const server = createServer()
  let record
  let fault = ''
  const containers = []
  try {
    mkdirSync(source)
    for (const file of ['deploy/oracle/docker-compose.yml', 'deploy/oracle/Caddyfile', 'deploy/oracle/mediamtx.yml.example',
      'scripts/discord-notifier.mjs', 'scripts/chat-alerts.mjs', 'scripts/chat-capacity/source.mjs', 'config/streaming-contract.v1.json']) {
      mkdirSync(join(source, file, '..'), { recursive: true })
      cpSync(file, join(source, file))
    }
    writeFileSync(join(source, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    const keys = join(directory, 'keys.txt')
    run('age-keygen', ['-o', keys])
    const recipient = run('age-keygen', ['-y', keys])
    const secrets = join(source, 'deploy/oracle/secrets.enc')
    mkdirSync(secrets)
    const values = {
      'caddy.env': ['PUBLIC_HOSTNAME=fixture.invalid', ...['MEDIAMTX_AUTH_SECRET', 'BETTER_AUTH_SECRET', 'INTERNAL_AUTH_SECRET', 'CHAT_TAG_HMAC_SECRET',
        'CENTRIFUGO_TOKEN_HMAC_SECRET', 'CENTRIFUGO_API_KEY'].map(key => `${key}=fixture-private-${'x'.repeat(32)}`)].join('\n'),
      'mediamtx.yml': readFileSync('deploy/oracle/mediamtx.yml.example', 'utf8'),
      'oci-usage.env': 'OCI_STATS_ENABLED=false\n', 'discord.env': 'DISCORD_WEBHOOK_URL=\n',
      'oci-usage-api-key.pem': 'fixture-private-key', 'admin.env': 'fixture-private-admin', 'credentials.txt': 'fixture-private-credentials',
    }
    for (const [name, value] of Object.entries(values)) {
      const plain = join(directory, name)
      writeFileSync(plain, value, { mode: 0o600 })
      writeFileSync(join(secrets, `${name}.enc`), run('sops', ['encrypt', '--age', recipient, '--input-type', 'binary', '--output-type', 'binary', plain], { cwd: directory }))
    }
    if (managed) {
      const { prepareManagedSource } = await import('./deployment-setup.mjs')
      await prepareManagedSource({ source, directory, image, project, mediaPorts })
    }
    for (const [path, sql] of Object.entries(migrations)) writeFileSync(join(source, path), sql)
    const git = (...args) => run('git', ['-C', source, ...args])
    git('init', '-q'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'tag', '-a', 'v1.2.3', '-m', 'fixture')
    const commit = git('rev-parse', 'HEAD')
    const fingerprint = run(process.execPath, [resolve('scripts/chat-capacity/source.mjs')], { cwd: source })
    writeFileSync(join(directory, 'Dockerfile'), readFileSync('scripts/fixtures/maintenance/Dockerfile', 'utf8') + '\nRUN cp scripts/fixtures/maintenance/server.mjs server.js && chown 1001:1001 /data\nUSER 1001\n')
    docker('build', '-q', '-t', image, '--label', `org.opencontainers.image.revision=${commit}`, '--label', `org.frankerzspam.source=${fingerprint}`,
      '-f', join(directory, 'Dockerfile'), '.')
    // The controlled registry boundary supplies these digests. All containers are real Docker containers.
    record = { format: 1, repository: 'tprjd/mediamtx-viewer', tag: 'v1.2.3', version: '1.2.3', commit,
      tagObject: git('rev-parse', 'v1.2.3'), sourceFingerprint: fingerprint,
      images: Object.fromEntries(['viewer', 'thumbnailer'].map(name => [name, `ghcr.io/tprjd/mediamtx-viewer/${name}@sha256:${'d'.repeat(64)}`])),
      verification: { version: 1, passed: true, sourceFingerprint: fingerprint, finishedAt: new Date().toISOString(), runId: '1', runAttempt: '1', checks: requiredChecks.map(name => ({ name, passed: true })) } }
    writeFileSync(join(directory, 'active.conf'), 'unchanged active configuration', { mode: 0o644 })
    for (const name of volumes) docker('volume', 'create', `${project}_${name}`)
    for (const service of ['viewer', 'caddy', 'centrifugo', 'mediamtx', 'mediamtx-health', 'thumbnailer', 'discord-notifier']) {
      const id = `${project}-${service}`
      const mounts = service === 'viewer' ? ['-v', `${project}_auth_data:/data`, '-v', `${project}_thumbnail_data:/thumbnails`]
        : service === 'caddy' ? ['-v', `${project}_caddy_data:/data`, '-v', `${project}_caddy_config:/config`, '-v', `${join(directory, 'active.conf')}:/etc/fixture.conf:ro`]
        : service === 'thumbnailer' ? ['-v', `${project}_thumbnail_data:/thumbnails`]
        : service === 'discord-notifier' ? ['-v', `${project}_discord_notifier_state:/state`] : []
      docker('run', '-d', '--name', id, '--label', `com.docker.compose.project=${project}`, '--label', `com.docker.compose.service=${service}`,
        ...mounts, '-e', 'AUTH_DB_PATH=/data/auth.sqlite', '-e', 'CHAT_DB_PATH=/data/chat.sqlite', '-e', `CHAT_ENABLED=${chat}`, image,
        ...(service === 'viewer' ? [] : ['node', '-e', 'setInterval(()=>{},1000)']))
      containers.push(id)
      if (service === 'centrifugo' && !chat) docker('stop', '-t', '1', id)
    }
    for (let n = 0; n < 50; n++) {
      try { docker('exec', `${project}-viewer`, 'wget', '-qO-', 'http://127.0.0.1:3000/api/health'); break } catch { await delay(100) }
    }
    let managedOptions = {}
    if (managed) {
      const { startManagedBaseline } = await import('./deployment-setup.mjs')
      managedOptions = await startManagedBaseline({ source, directory, image, project, chat, migrations })
    }
    if (managed && Object.keys(migrations).length) {
      docker('tag', image, `${project}:base`)
      writeFileSync(join(directory, 'candidate.Dockerfile'), `FROM ${image}\nCOPY source/migrations /app/migrations\nCOPY source/chat-migrations /app/chat-migrations\n`)
      docker('build', '-q', '-t', image, '-f', join(directory, 'candidate.Dockerfile'), directory)
    }
    const bin = join(directory, 'bin')
    mkdirSync(bin)
    writeFileSync(join(directory, 'fault'), '')
    const realDocker = run('which', ['docker'])
    writeFileSync(join(bin, 'docker'), `#!/usr/bin/env node
const {spawnSync}=require('node:child_process');
const args=process.argv.slice(2);
if(args.includes('flock')) {const child=require('node:child_process').spawn(${JSON.stringify(realDocker)},args,{stdio:'inherit'});child.on('exit',code=>process.exit(code??1));return}
if(args.some(value=>value.includes('fixture-private')))throw new Error('Private value entered Docker arguments');
// Architecture is a controlled host/registry measurement. Containers use the
// native test CPU, so the same command suite runs on ARM64 and x64 runners.
if(args.includes('info') && args.includes('{{json .}}')) {
 const r=spawnSync(${JSON.stringify(realDocker)},args,{encoding:'utf8'});if(r.status)process.exit(r.status);
 const v=JSON.parse(r.stdout);v.Architecture=require('fs').readFileSync(${JSON.stringify(join(directory, 'fault'))},'utf8')==='host-architecture'?'x86_64':'aarch64';
 require('fs').writeFileSync(1,JSON.stringify(v));process.exit(0);
}
if(require('fs').readFileSync(${JSON.stringify(join(directory, 'fault'))},'utf8')==='backup-key' && args.includes('compose') && args.includes('config')) {
 const r=spawnSync(${JSON.stringify(realDocker)},args,{encoding:'utf8'});if(r.status)process.exit(r.status);
 const v=JSON.parse(r.stdout);v.services.caddy.environment.AUTH_BACKUP_KEY=Buffer.alloc(32,99).toString('base64');
 require('fs').writeFileSync(1,JSON.stringify(v));process.exit(0);
}
if(require('fs').readFileSync(${JSON.stringify(join(directory, 'fault'))},'utf8')==='volume-swap' && args.includes('compose') && args.includes('config')) {
 const r=spawnSync(${JSON.stringify(realDocker)},args,{encoding:'utf8'});if(r.status)process.exit(r.status);
 const v=JSON.parse(r.stdout);v.volumes.auth_data.name=v.volumes.thumbnail_data.name;
 require('fs').writeFileSync(1,JSON.stringify(v));process.exit(0);
}
const ref=args.find(a=>a.startsWith('ghcr.io/tprjd/mediamtx-viewer/'));
if(ref && args.includes('pull')) process.exit(require('fs').readFileSync(${JSON.stringify(join(directory, 'fault'))},'utf8')==='registry'?1:0);
if(args.includes('manifest')) {console.log(JSON.stringify({schemaVersion:2,layers:[{size:100000000}]}));process.exit(0)}
if(ref && args.includes('inspect')) {
 const r=spawnSync(${JSON.stringify(realDocker)},['image','inspect',${JSON.stringify(image)}],{encoding:'utf8'});
 if(r.status)process.exit(r.status);
 const v=JSON.parse(r.stdout);v[0].Architecture='arm64';v[0].RepoDigests=[require('fs').readFileSync(${JSON.stringify(join(directory, 'fault'))},'utf8')==='digest'?'wrong':ref];
 if(require('fs').readFileSync(${JSON.stringify(join(directory, 'fault'))},'utf8')==='architecture')v[0].Architecture='amd64';
 require('fs').writeFileSync(1,JSON.stringify(v));process.exit(0);
}
if(args.includes('image') && args.includes('inspect') && !ref) {
 const r=spawnSync(${JSON.stringify(realDocker)},args,{encoding:'utf8'});if(r.status)process.exit(r.status);
 const v=JSON.parse(r.stdout);v[0].Architecture='arm64';require('fs').writeFileSync(1,JSON.stringify(v));process.exit(0);
}
if(args.includes('pull') && !ref) {
 const platform=args.indexOf('--platform');if(platform>=0)args.splice(platform,2);
 const check=spawnSync(${JSON.stringify(realDocker)},['image','inspect',args.at(-1)],{stdio:'ignore'});
 if(check.status===0)process.exit(0);
}
if(require('fs').readFileSync(${JSON.stringify(join(directory, 'fault'))},'utf8')==='host-space' && args.includes('/app/stage-host.mjs') && args.includes('check')) {
 const input=JSON.parse(args.at(-1));input.imageBytes=4000000000000000;args[args.length-1]=JSON.stringify(input);
}
if(args.includes('compose') && (args.includes('up') || args.includes('run'))) {
 const fs=require('fs'), index=args.indexOf('-f')+1;
 const model=JSON.parse(fs.readFileSync(args[index],'utf8'));
 const failure=fs.readFileSync(${JSON.stringify(join(directory, 'fault'))},'utf8');
 const candidate=model.services.viewer.environment.FIXTURE_VERSION==='1.2.3';
 if(args.includes('up') && (failure==='rollback-failure' || candidate && ['activation-failure','interrupt-rollback'].includes(failure)))process.exit(1);
 if(candidate && failure==='wrong-version')model.services.viewer.environment.FIXTURE_VERSION='wrong';
 if(candidate && ['degraded-chat','migration-history','volume-ownership'].includes(failure))model.services.viewer.environment.FIXTURE_FAILURE=failure;
 if(candidate && failure==='unhealthy-service')model.services.thumbnailer.healthcheck={test:['CMD','node','-e','process.exit(1)'],interval:'1s',timeout:'1s',retries:1};
 for(const service of Object.values(model.services))if(service.image.startsWith('ghcr.io/tprjd/mediamtx-viewer/'))service.image=${JSON.stringify(image)};
 const path=args[index]+'.fixture';fs.writeFileSync(path,JSON.stringify(model));args[index]=path;
}
if(ref)args[args.indexOf(ref)]=${JSON.stringify(image)};
const r=spawnSync(${JSON.stringify(realDocker)},args,{encoding:'utf8'});
const failure=require('fs').readFileSync(${JSON.stringify(join(directory, 'fault'))},'utf8');
if(!r.status && failure==='interrupt-owner-creation' && args.includes('create') && args.some(a=>a.endsWith('-deploy-operation'))) {process.kill(process.ppid,'SIGKILL');process.exit(0)}
if(!r.status && failure==='interrupt-staging' && args.includes('cp') && args.at(-1).includes('-stage-operation:/stage/') && args.at(-1).endsWith('/source')) {process.kill(process.ppid,'SIGKILL');process.exit(0)}
if(!r.status && failure==='interrupt-maintenance' && args.includes('stop') && args.includes('10')) {process.kill(process.ppid,'SIGKILL');process.exit(0)}
if(!r.status && ((failure==='interrupt-helper-cleanup' && args.includes('rm') && args.some(a=>a.startsWith('maintenance-tool-'))) ||
 (failure==='interrupt-proxy-cleanup' && args.includes('rm') && args.some(a=>a.startsWith('maintenance-proxy-'))) ||
 (failure==='interrupt-auth' && args.includes('run') && args.some(a=>a.endsWith('-auth'))) ||
 (failure==='interrupt-chat-running' && args.includes('run') && args.some(a=>a.endsWith('-chat'))) ||
 (failure==='interrupt-chat' && args.includes('wait') && args.some(a=>a.endsWith('-chat'))) ||
 (failure==='interrupt-rollback' && args.includes('up') && args.includes('viewer')) ||
 (failure==='interrupt-activation' && args.includes('up') && args.includes('viewer')) ||
 (failure==='interrupt-completion' && args.includes('/app/scripts/maintenance-host.mjs') && args.includes('finish')))) {process.kill(process.ppid,'SIGKILL');process.exit(0)}
if(!r.status && failure==='stale-acknowledgement' && args.includes('/app/scripts/maintenance-host.mjs') && args.includes('phase') && JSON.parse(args.at(-1)).phase==='held') {
 const helper=args[args.indexOf('exec')+1];
 spawnSync(${JSON.stringify(realDocker)},['exec',helper,'node','/app/scripts/maintenance-host.mjs','phase',JSON.stringify({acknowledgement:{deploymentAttempt:'old-attempt',attempt:'old-backup',backupId:'old-set'}})],{stdio:'ignore'});
}
if(!r.status && failure==='interrupt-inflight' && args.includes('cp') && args.some(a=>a.includes('/deployment-backups/') && a.endsWith('auth.sqlite.enc'))) {
 process.kill(process.ppid,'SIGKILL');
 while(require('fs').readFileSync(${JSON.stringify(join(directory, 'fault'))},'utf8')==='interrupt-inflight')Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);
}
if(!r.status && failure==='pause-transfer' && args.includes('cp') && args.some(a=>a.includes('/deployment-backups/') && a.endsWith('auth.sqlite.enc'))) {
 require('fs').writeFileSync(${JSON.stringify(join(directory, 'paused'))},'paused');
 while(require('fs').readFileSync(${JSON.stringify(join(directory, 'fault'))},'utf8')==='pause-transfer')Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);
}
if(!r.status && failure==='interrupt-transfer' && args.includes('cp') && args.some(a=>a.includes('/deployment-backups/') && a.endsWith('auth.sqlite.enc'))) {process.kill(process.ppid,'SIGKILL');process.exit(0)}
if(!r.status && failure==='transfer-failure' && args.includes('cp') && args.some(a=>a.includes('/deployment-backups/') && a.endsWith('chat.sqlite.enc')))process.exit(1);
if(!r.status && ['pending-migrations','static-proxy'].includes(failure) && args.includes('cp') && args.at(-1).includes('-stage-operation:/stage/') && args.at(-1).endsWith('/source')) {
 const [container,path]=args.at(-1).split(':');
 const injected=spawnSync(${JSON.stringify(realDocker)},['exec',container,'node','-e',"require('fs').writeFileSync(process.argv[1]+(process.argv[2]==='static-proxy'?'/deploy/oracle/Caddyfile':'/migrations/999_pending.sql'),process.argv[2]==='static-proxy'?':80 { respond bogus 200 }':'SELECT 1;')",path,failure],{encoding:'utf8'});
 if(injected.status)process.exit(injected.status);
}
require('fs').writeFileSync(1,r.stdout||'');require('fs').writeFileSync(2,r.stderr||'');
if(r.status)require('fs').appendFileSync(${JSON.stringify(join(directory, 'debug.txt'))},JSON.stringify(args)+' '+r.stderr+'\\n');
process.exit(r.status??1);
`)
    chmodSync(join(bin, 'docker'), 0o700)
    const realSops = run('which', ['sops'])
    writeFileSync(join(bin, 'sops'), `#!/usr/bin/env node
const {spawnSync}=require('node:child_process');
const args=process.argv.slice(2);
if(require('fs').readFileSync(${JSON.stringify(join(directory, 'fault'))},'utf8')==='configuration' && args.at(-1).endsWith('mediamtx.yml.enc')) {console.log('invalid: [');process.exit(0)}
const r=spawnSync(${JSON.stringify(realSops)},args,{stdio:'inherit'});process.exit(r.status??1);
`, { mode: 0o700 })
    server.on('request', (request, response) => {
      response.setHeader('Content-Type', 'application/json')
      const path = request.url
      if (fault === 'refresh-original-expired' && path.includes('/actions/runs/1/')) { response.statusCode = 404; response.end('{}'); return }
      const value = structuredClone(record)
      if (fault === 'stale' || fault.startsWith('refresh')) value.verification.finishedAt = new Date(Date.now() - 86401000).toISOString()
      if (fault === 'checks') value.verification.checks.pop()
      if (fault === 'version') value.version = '9.9.9'
      if (path.includes('/assets/2')) {
        value.verification.finishedAt = new Date().toISOString()
        value.verification.runId = '2'
        if (fault === 'refresh-digest') value.images.viewer = value.images.viewer.replace(/d{64}/, 'e'.repeat(64))
      }
      response.end(JSON.stringify(/\/assets\/[12]/.test(path) ? value : path.includes('/assets?') ? [{ id: 1, name: 'release.json', state: 'uploaded' },
        ...(fault.startsWith('refresh') ? [{ id: 2, name: 'verification-2-1.json', state: 'uploaded' }] : [])]
        : path.includes('/git/ref/') ? { object: { type: 'tag', sha: fault === 'tag' ? 'a'.repeat(40) : record.tagObject } }
        : path.includes('/git/tags/') ? { object: { type: 'commit', sha: commit } }
        : path.includes('/actions/') ? { id: path.includes('/runs/2/') ? 2 : 1, run_attempt: 1, status: 'completed', conclusion: 'success', head_sha: commit, path: '.github/workflows/release.yml', repository: { full_name: 'tprjd/mediamtx-viewer' } }
        : { id: 1, tag_name: 'v1.2.3', draft: false }))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const command = (action = 'prepare', extra = {}, flags = []) => new Promise(resolve => {
      const child = spawn('sh', ['deploy/oracle/deploy.sh', action, 'local', ...(['prepare', 'managed'].includes(action) ? ['v1.2.3'] : []), '--project', project, '--directory', join(directory, 'copies'), ...flags, ...(['managed', 'recover'].includes(action) && managedOptions.url ? ['--url', managedOptions.url] : [])], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DOCKER_HOST: endpoint,
          AUTH_BACKUP_KEY: managedOptions.key, GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, SOPS_AGE_KEY_FILE: keys,
          GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${source}.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/tprjd/mediamtx-viewer.git', STAGE_FAULT: fault, ...extra },
      })
      let stdout = '', stderr = ''
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
      child.on('close', status => { let diagnostic = ''; try { diagnostic = readFileSync(join(directory, 'debug.txt'), 'utf8') } catch {} resolve({ status, stdout, stderr, diagnostic }) })
    })
    await work({ ...managedOptions, directory, source, project, image, record, command, fault: value => { fault = value; writeFileSync(join(directory, 'fault'), value) }, viewer: managed ? `${project}-viewer-1` : `${project}-viewer` })
  } finally {
    server.closeAllConnections()
    if (server.listening) await new Promise(resolve => server.close(resolve))
    const ids = docker('ps', '-aq', '--filter', `label=org.frankerzspam.staging=${project}`).split('\n').filter(Boolean)
    if (ids.length) docker('rm', '-f', ...ids)
    const live = docker('ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`).split('\n').filter(Boolean)
    for (const id of live) if (inspect(id).State.Paused) docker('unpause', id)
    if (live.length) docker('rm', '-f', ...live)
    try { docker('rm', '-f', `${project}-deploy-operation`) } catch {}
    try { docker('network', 'rm', `${project}_default`) } catch {}
    for (const name of [...volumes.map(name => `${project}_${name}`), `${project}-deployment-staging`]) {
      try { docker('volume', 'rm', name) } catch { /* Not created before an early failure. */ }
    }
    try { docker('image', 'rm', `${project}:previous`) } catch {}
    try { docker('image', 'rm', `${project}:base`) } catch {}
    try { docker('image', 'rm', image) } catch { /* Build failed. */ }
    rmSync(directory, { recursive: true, force: true })
  }
}
