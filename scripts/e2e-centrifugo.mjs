import { spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const containerName = 'mediamtx-viewer-e2e-centrifugo'
const image =
  'centrifugo/centrifugo:v6.9.3@sha256:017d0a3d39757f94a09efa657b6ad7e68222564dd9ba7dd7193981d75cd8a025'
const apiKey =
  process.env.CENTRIFUGO_API_KEY ??
  'e2e-centrifugo-api-key-that-is-at-least-32-characters'
const tokenSecret =
  process.env.CENTRIFUGO_TOKEN_HMAC_SECRET ??
  'e2e-centrifugo-token-secret-that-is-at-least-32-characters'

function removeContainer() {
  spawnSync('docker', ['rm', '--force', containerName], { stdio: 'ignore' })
}

removeContainer()
const started = spawnSync(
  'docker',
  [
    'run',
    '--detach',
    '--name',
    containerName,
    '--label',
    'com.frankerzspam.e2e=true',
    '--publish',
    '127.0.0.1:3800:8000',
    '--env',
    `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY=${tokenSecret}`,
    '--env',
    'CENTRIFUGO_CLIENT_TOKEN_AUDIENCE=frankerzspam-chat',
    '--env',
    'CENTRIFUGO_CLIENT_TOKEN_ISSUER=frankerzspam-viewer',
    '--env',
    'CENTRIFUGO_CLIENT_DISALLOW_ANONYMOUS_CONNECTION_TOKENS=true',
    '--env',
    `CENTRIFUGO_HTTP_API_KEY=${apiKey}`,
    '--env',
    'CENTRIFUGO_HEALTH_ENABLED=true',
    '--env',
    'CENTRIFUGO_CLIENT_ALLOWED_ORIGINS=http://localhost:3299',
    '--env',
    'CENTRIFUGO_CHANNEL_NAMESPACES=[{"name":"chat","history_size":300,"history_ttl":"30s","force_recovery":true,"force_positioning":true,"allow_subscribe_for_client":false,"allow_publish_for_client":false,"allow_publish_for_subscriber":false},{"name":"control","allow_subscribe_for_client":false,"allow_publish_for_client":false,"allow_publish_for_subscriber":false}]',
    image,
  ],
  { encoding: 'utf8' },
)

if (started.status !== 0) {
  process.stderr.write(started.stderr || 'Could not start Centrifugo.\n')
  process.exit(1)
}

let stopping = false
const keepAlive = setInterval(() => undefined, 60_000)
function stop() {
  if (stopping) return
  stopping = true
  clearInterval(keepAlive)
  removeContainer()
  process.exit(0)
}

process.once('SIGINT', stop)
process.once('SIGTERM', stop)
process.once('exit', removeContainer)

// Start Docker before probing its port. Some hosts leave a removed container's
// port in a timeout state instead of rejecting the initial connection.
const deadline = Date.now() + 30_000
for (;;) {
  try {
    const response = await fetch('http://127.0.0.1:3800/health', {
      signal: AbortSignal.timeout(1_000),
    })
    if (response.ok) break
  } catch { /* Wait for the container's listener. */ }
  if (Date.now() >= deadline) {
    console.error('Centrifugo health check failed')
    process.exit(1)
  }
  await delay(100)
}
console.log('Centrifugo health check passed')
