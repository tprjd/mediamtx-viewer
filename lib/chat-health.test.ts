// @vitest-environment node
import Database from 'better-sqlite3'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/env', () => ({ getRuntimeConfigurationErrors: () => [] }))
vi.mock('@/lib/auth/store', () => ({ isDatabaseReady: () => true }))
const directory = mkdtempSync(join(tmpdir(), 'chat-health-'))
process.env.CHAT_DB_PATH = join(directory, 'chat.sqlite')
process.env.CHAT_ENABLED = 'true'
const online = vi.fn(async () => Response.json({ result: {} }))

beforeAll(() => {
  const result = spawnSync(process.execPath, ['scripts/migrate-chat.mjs'], {
    env: process.env,
  })
  expect(result.status).toBe(0)
})
afterAll(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  rmSync(directory, { recursive: true, force: true })
})

it('reports disabled, healthy, degraded, and unavailable without failing core health', async () => {
  const { inspectChatHealth } = await import('./chat-health')
  expect((await inspectChatHealth(online)).status).toBe('healthy')
  vi.stubEnv('CHAT_ENABLED', 'false')
  expect((await inspectChatHealth(online)).status).toBe('disabled')
  vi.stubEnv('CHAT_ENABLED', 'true')
  const offline = vi.fn(async () => {
    throw new Error('secret token participant content')
  })
  expect(await inspectChatHealth(offline)).toMatchObject({
    status: 'degraded',
    faults: ['centrifugo'],
  })
  const locked = new Database(process.env.CHAT_DB_PATH!)
  locked.exec('BEGIN IMMEDIATE')
  try {
    expect(await inspectChatHealth(online)).toMatchObject({
      status: 'unavailable',
      faults: ['database'],
      uncheckedFaults: expect.arrayContaining([
        'outbox',
        'database-limit',
        'disk-limit',
      ]),
    })
    vi.stubGlobal('fetch', offline)
    const { GET } = await import('@/app/api/health/route')
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'ok',
      chat: { status: 'unavailable' },
    })
  } finally {
    locked.exec('ROLLBACK')
    locked.close()
  }
  expect((await inspectChatHealth(online)).status).toBe('healthy')
})

it('reports disk thresholds and pending deliveries without exposing participant data', async () => {
  const { inspectChatHealth, getChatHealth } = await import('./chat-health')
  const database = new Database(process.env.CHAT_DB_PATH!)
  const secrets = [
    'private-message-content',
    'private-profile-name',
    'private-note',
    'private-token',
    'private-cookie',
    'private-idempotency-key',
  ]
  const logs = [
    vi.spyOn(console, 'info'),
    vi.spyOn(console, 'warn'),
    vi.spyOn(console, 'error'),
    vi.spyOn(console, 'log'),
  ]
  try {
    database
      .prepare(
        'INSERT INTO chat_outbox (id, channel_name, payload, created_at, next_attempt_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        'opaque-event',
        'chat:opaque-room',
        JSON.stringify(secrets),
        Date.now() - 301_000,
        Date.now(),
      )
    expect(await inspectChatHealth(online)).toMatchObject({
      status: 'degraded',
      faults: ['outbox'],
      outboxDepth: 1,
      oldestOutboxAgeSeconds: 301,
    })
    vi.stubEnv('CHAT_DATABASE_LIMIT_BYTES', '1')
    expect((await inspectChatHealth(online)).faults).toContain('database-limit')
    vi.stubEnv('CHAT_DATABASE_LIMIT_BYTES', '2147483648')
    vi.stubEnv('CHAT_MINIMUM_FREE_BYTES', String(Number.MAX_SAFE_INTEGER))
    expect((await inspectChatHealth(online)).faults).toContain('disk-limit')
    vi.stubGlobal('fetch', async () => {
      throw new Error(secrets.join(' '))
    })
    await getChatHealth()
    const captured = JSON.stringify(logs.flatMap((log) => log.mock.calls))
    expect(captured).toContain('chat-health')
    for (const secret of secrets) expect(captured).not.toContain(secret)
  } finally {
    database.prepare('DELETE FROM chat_outbox').run()
    database.close()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    for (const log of logs) log.mockRestore()
  }
})

it('reports how long a fault has remained active and clears it after recovery', async () => {
  const { getChatHealth } = await import('./chat-health')
  vi.stubGlobal('fetch', online)
  await getChatHealth()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  try {
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })
    expect((await getChatHealth()).faultDetails).toEqual([
      {
        code: 'centrifugo',
        checked: true,
        since: new Date(1_000_000).toISOString(),
        sustained: false,
      },
    ])
    clock.mockReturnValue(1_300_000)
    expect((await getChatHealth()).faultDetails[0].sustained).toBe(true)
    vi.stubGlobal('fetch', online)
    expect((await getChatHealth()).faultDetails).toEqual([])
  } finally {
    clock.mockRestore()
    vi.unstubAllGlobals()
  }
})
