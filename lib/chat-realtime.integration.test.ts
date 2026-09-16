// @vitest-environment node

import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Centrifuge } from 'centrifuge'

vi.mock('server-only', () => ({}))

const CENTRIFUGO_IMAGE =
  'centrifugo/centrifugo:v6.9.3@sha256:017d0a3d39757f94a09efa657b6ad7e68222564dd9ba7dd7193981d75cd8a025'
const apiKey = 'integration-centrifugo-api-key-at-least-32-characters'
const tokenSecret =
  'integration-centrifugo-token-secret-at-least-32-characters'
const containerName = `mediamtx-viewer-chat-test-${process.pid}-${randomUUID().slice(0, 8)}`

let port = 0
let container: ChildProcess | undefined

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Centrifugo did not become healthy')
}

async function callCentrifugoApi<T>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}/api/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  })
  expect(response.ok).toBe(true)
  return (await response.json()) as T
}

function nextEvent<T>(
  client: Centrifuge,
  event: 'connected' | 'disconnected' | 'publication' | 'subscribed',
  predicate: (value: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 5_000)
    const listener = (value: unknown) => {
      if (!predicate(value as T)) return
      clearTimeout(timeout)
      client.removeListener(event, listener as never)
      resolve(value as T)
    }
    client.on(event, listener as never)
  })
}

describe('Centrifugo Chat delivery', () => {
  beforeAll(async () => {
    port = await reservePort()
    process.env.CHAT_ENABLED = 'true'
    process.env.CENTRIFUGO_API_KEY = apiKey
    process.env.CENTRIFUGO_API_URL = `http://127.0.0.1:${port}/api`
    process.env.CENTRIFUGO_TOKEN_HMAC_SECRET = tokenSecret
    container = spawn(
      'docker',
      [
        'run',
        '--rm',
        '--name',
        containerName,
        '--publish',
        `127.0.0.1:${port}:8000`,
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
        'CENTRIFUGO_LOG_LEVEL=warn',
        '--env',
        'CENTRIFUGO_CHANNEL_NAMESPACES=[{"name":"chat","history_size":300,"history_ttl":"30s","force_recovery":true,"force_positioning":true,"allow_subscribe_for_client":false,"allow_publish_for_client":false,"allow_publish_for_subscriber":false},{"name":"control","allow_subscribe_for_client":false,"allow_publish_for_client":false,"allow_publish_for_subscriber":false}]',
        CENTRIFUGO_IMAGE,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    await waitForHealth()
  }, 30_000)

  afterAll(() => {
    spawnSync('docker', ['rm', '--force', containerName], { stdio: 'ignore' })
    container?.kill('SIGTERM')
    delete process.env.CHAT_ENABLED
    delete process.env.CENTRIFUGO_API_KEY
    delete process.env.CENTRIFUGO_API_URL
    delete process.env.CENTRIFUGO_TOKEN_HMAC_SECRET
  })

  it('enforces subscriptions, blocks direct publication, recovers, and disconnects an account', async () => {
    const {
      chatControlChannel,
      chatTranscriptChannel,
      createChatConnectionToken,
      disconnectChatParticipant,
      publishChatEvent,
    } = await import('@/lib/chat-realtime')
    const accountId = 'integration-participant'
    const channelId = 'integration-channel'
    const transcriptChannel = chatTranscriptChannel(channelId)
    const controlChannel = chatControlChannel(accountId)
    const client = new Centrifuge(
      `ws://127.0.0.1:${port}/connection/websocket`,
      {
        getToken: async () =>
          createChatConnectionToken({ accountId, channelId, secret: tokenSecret }),
        websocket: WebSocket,
      },
    )
    const subscriptions = new Set<string>()
    client.on('subscribed', ({ channel }) => subscriptions.add(channel))
    const connected = nextEvent(client, 'connected')
    client.connect()
    await connected
    await vi.waitFor(() => {
      expect(subscriptions).toEqual(new Set([transcriptChannel, controlChannel]))
    })

    await expect(client.publish(transcriptChannel, { unsafe: true })).rejects.toMatchObject({
      code: 103,
    })
    const arbitrarySubscription = client.newSubscription('chat:arbitrary')
    arbitrarySubscription.subscribe()
    await expect(arbitrarySubscription.ready(2_000)).rejects.toMatchObject({
      code: 7,
    })
    expect(arbitrarySubscription.state).toBe('unsubscribed')

    const firstPublication = nextEvent<{ data: unknown }>(client, 'publication')
    await publishChatEvent(
      transcriptChannel,
      { type: 'message', eventId: 'one' },
      'stable-publication-one',
    )
    await expect(firstPublication).resolves.toMatchObject({
      data: { type: 'message', eventId: 'one' },
    })

    const disconnected = nextEvent(client, 'disconnected')
    client.disconnect()
    await disconnected
    await publishChatEvent(
      transcriptChannel,
      { type: 'message', eventId: 'missed' },
      'stable-publication-missed',
    )
    const recoveredPublication = nextEvent<{ data: unknown }>(client, 'publication')
    const recoveredSubscription = nextEvent<{ channel: string; recovered: boolean }>(
      client,
      'subscribed',
      ({ channel }) => channel === transcriptChannel,
    )
    client.connect()
    await expect(recoveredSubscription).resolves.toMatchObject({ recovered: true })
    await expect(recoveredPublication).resolves.toMatchObject({
      data: { type: 'message', eventId: 'missed' },
    })

    const accountDisconnected = nextEvent<{ code: number }>(client, 'disconnected')
    await disconnectChatParticipant(accountId)
    await expect(accountDisconnected).resolves.toMatchObject({ code: 3500 })
  }, 20_000)

  it('replaces an expired connection token and connects within five seconds', async () => {
    const { createChatConnectionToken } = await import('@/lib/chat-realtime')
    let tokenRequests = 0
    const client = new Centrifuge(
      `ws://127.0.0.1:${port}/connection/websocket`,
      {
        getToken: async () => {
          tokenRequests += 1
          return createChatConnectionToken({
            accountId: 'refresh-participant',
            channelId: 'refresh-channel',
            now:
              tokenRequests === 1
                ? new Date(Date.now() - 301_000)
                : new Date(),
            secret: tokenSecret,
          })
        },
        minReconnectDelay: 250,
        maxReconnectDelay: 3_000,
        websocket: WebSocket,
      },
    )
    const connected = nextEvent(client, 'connected')
    const startedAt = Date.now()
    client.connect()

    await connected
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(tokenRequests).toBe(2)
    client.disconnect()
  }, 10_000)

  it('keeps participant content and secrets out of application and Centrifugo logs', async () => {
    const { publishChatEvent, createChatConnectionToken } = await import(
      '@/lib/chat-realtime'
    )
    const secrets = [
      'log-test-message-content',
      'log-test-profile-name',
      'log-test-private-note',
      'log-test-cookie',
      'log-test-client-key',
    ]
    const logs = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
    ]
    const token = createChatConnectionToken({
      accountId: 'log-participant',
      channelId: 'log-room',
    })
    const client = new Centrifuge(
      `ws://127.0.0.1:${port}/connection/websocket`,
      { token, websocket: WebSocket },
    )
    try {
      const connected = nextEvent(client, 'connected')
      client.connect()
      await connected
      await publishChatEvent(
        'chat:log-room',
        { content: secrets[0], profileName: secrets[1] },
        'opaque-publication-id',
      )
      // Rejected requests must not turn their body, credentials, or private fields into logs.
      await fetch(`http://127.0.0.1:${port}/api/publish`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'log-test-invalid-token',
          cookie: secrets[3],
        },
        body: JSON.stringify({
          channel: 'chat:log-room',
          data: secrets,
          idempotency_key: secrets[4],
        }),
      })
      await expect(
        publishChatEvent('chat:log-room', secrets, secrets[4], async () => {
          throw new Error(secrets.join(' '))
        }),
      ).rejects.toThrow()
      const output = spawnSync('docker', ['logs', containerName], {
        encoding: 'utf8',
      })
      expect(output.status).toBe(0)
      const captured =
        output.stdout +
        output.stderr +
        JSON.stringify(logs.flatMap((log) => log.mock.calls))
      for (const secret of [
        ...secrets,
        token,
        apiKey,
        tokenSecret,
        'log-test-invalid-token',
      ])
        expect(captured).not.toContain(secret)
    } finally {
      client.disconnect()
      for (const log of logs) log.mockRestore()
    }
  })

  it('keeps no more than 300 room publications in memory', async () => {
    const { publishChatEvent } = await import('@/lib/chat-realtime')
    const channel = 'chat:retention-integration-channel'
    for (let index = 0; index < 301; index += 1) {
      await publishChatEvent(
        channel,
        { index },
        `retention-publication-${index}`,
      )
    }

    const history = await callCentrifugoApi<{
      result: { publications: Array<{ data: { index: number } }> }
    }>('history', { channel, limit: 301 })
    expect(history.result.publications).toHaveLength(300)
    expect(history.result.publications.at(-1)?.data).toEqual({ index: 300 })
  }, 20_000)
})
