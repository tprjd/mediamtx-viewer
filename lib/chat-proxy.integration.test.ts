// @vitest-environment node
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { afterAll, expect, it, vi } from 'vitest'
import { Centrifuge } from 'centrifuge'

vi.mock('server-only', () => ({}))
const access = vi.hoisted(() => ({ allowed: true, sessionActive: true }))
vi.mock('@/lib/viewing-access', () => ({ canWatchChannel: () => access.allowed }))
vi.mock('@/lib/auth/database', () => ({ getDatabase: () => ({ prepare: (sql: string) => ({ get: () => sql.includes('FROM session') ? (access.sessionActive ? { present: 1 } : undefined) : { slug: 'test' } }) }) }))
vi.mock('@/lib/chat-maintenance', () => ({ isChatRestoring: () => false }))

const name = `chat-access-proxy-test-${process.pid}`
const clients: Centrifuge[] = []
const secret = 'development-only-secret-change-before-production'
let authorizedRefreshes = 0
let deniedRefreshes = 0
const server = createServer(async (request, response) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk)
  const input = new Request(`http://localhost${request.url}`, {
    method: 'POST', headers: { 'x-internal-auth': String(request.headers['x-internal-auth'] ?? '') },
    body: Buffer.concat(chunks).toString(),
  })
  const handler = request.url === '/connect'
    ? await import('@/app/api/internal/chat/connect/route')
    : await import('@/app/api/internal/chat/refresh/route')
  const output = await handler.POST(input)
  const body = await output.json()
  if (request.url === '/refresh') {
    if (body.result?.expire_at) authorizedRefreshes++
    if (body.result?.expired) deniedRefreshes++
  }
  // Shorten only the test lease so periodic authorization runs during this test.
  if (body.result?.expire_at) body.result.expire_at = Math.floor(Date.now() / 1000) + 1
  response.writeHead(output.status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
})
afterAll(async () => {
  clients.forEach(client => client.disconnect())
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 10000 })
  await new Promise<void>(resolve => server.close(() => resolve()))
  delete process.env.CHAT_ENABLED
})

it('uses production connect and refresh proxies to reject revoked credentials and expire open connections', async () => {
  process.env.CHAT_ENABLED = 'true'
  await new Promise<void>(resolve => server.listen(0, '0.0.0.0', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing HTTP port')
  const endpoint = `http://host.docker.internal:${address.port}`
  const child = spawn('docker', ['run', '--rm', '--name', name, '--add-host', 'host.docker.internal:host-gateway', '-p', '127.0.0.1::8000',
    '-e', 'CENTRIFUGO_HEALTH_ENABLED=true',
    '-e', 'CENTRIFUGO_CLIENT_PROXY_CONNECT_ENABLED=true',
    '-e', `CENTRIFUGO_CLIENT_PROXY_CONNECT_ENDPOINT=${endpoint}/connect`,
    '-e', `CENTRIFUGO_CLIENT_PROXY_CONNECT_HTTP_STATIC_HEADERS={"X-Internal-Auth":"${secret}"}`,
    '-e', 'CENTRIFUGO_CLIENT_PROXY_REFRESH_ENABLED=true',
    '-e', `CENTRIFUGO_CLIENT_PROXY_REFRESH_ENDPOINT=${endpoint}/refresh`,
    '-e', `CENTRIFUGO_CLIENT_PROXY_REFRESH_HTTP_STATIC_HEADERS={"X-Internal-Auth":"${secret}"}`,
    '-e', 'CENTRIFUGO_CLIENT_PROXY_REFRESH_INCLUDE_CONNECTION_META=true',
    '-e', 'CENTRIFUGO_CHANNEL_NAMESPACES=[{"name":"chat"},{"name":"control"}]',
    'centrifugo/centrifugo:v6.9.3@sha256:017d0a3d39757f94a09efa657b6ad7e68222564dd9ba7dd7193981d75cd8a025'], { stdio: 'ignore' })
  child.unref()
  let port = ''
  await vi.waitFor(() => {
    port = spawnSync('docker', ['port', name, '8000'], { encoding: 'utf8' }).stdout?.trim().split(':').at(-1) ?? ''
    expect(port).toMatch(/^\d+$/)
  }, { timeout: 15000, interval: 250 })
  await vi.waitFor(async () => expect((await fetch(`http://127.0.0.1:${port}/health`)).ok).toBe(true))
  const { createChatConnectionToken } = await import('@/lib/chat-realtime')
  const token = createChatConnectionToken({ accountId: 'viewer', channelId: 'channel', sessionId: 'test-session' })
  function client() {
    const connection = new Centrifuge(`ws://127.0.0.1:${port}/connection/websocket`, { getData: async () => ({ token }), websocket: WebSocket })
    clients.push(connection)
    return connection
  }
  const active = client()
  const connected = new Promise(resolve => active.once('connected', resolve))
  active.connect()
  await connected
  await vi.waitFor(() => expect(authorizedRefreshes).toBeGreaterThan(0), { timeout: 15000 })
  access.allowed = false
  const expired = new Promise<{ code: number }>(resolve => active.once('disconnected', resolve))
  const revoked = client()
  const rejected = new Promise<{ code: number }>(resolve => revoked.once('disconnected', resolve))
  revoked.connect()
  expect((await rejected).code).toBe(3500)
  expect((await expired).code).toBeGreaterThanOrEqual(3500)
  expect(deniedRefreshes).toBeGreaterThan(0)

  access.allowed = true
  const sessionClient = client()
  const sessionConnected = new Promise(resolve => sessionClient.once('connected', resolve))
  sessionClient.connect()
  await sessionConnected
  access.sessionActive = false
  const sessionExpired = new Promise<{ code: number }>(resolve => sessionClient.once('disconnected', resolve))
  const revokedSessionClient = client()
  const sessionRejected = new Promise<{ code: number }>(resolve => revokedSessionClient.once('disconnected', resolve))
  revokedSessionClient.connect()
  expect((await sessionRejected).code).toBe(3500)
  expect((await sessionExpired).code).toBeGreaterThanOrEqual(3500)
}, 45000)
