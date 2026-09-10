// @vitest-environment node

import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const sessionState = vi.hoisted(() => ({ accountId: 'viewer-id' as string | null }))

vi.mock('@/lib/auth/session', () => ({
  getActiveSession: vi.fn(async () =>
    sessionState.accountId ? { user: { id: sessionState.accountId } } : null,
  ),
}))

const testDirectory = mkdtempSync(join(tmpdir(), 'mediamtx-chat-test-'))
const authDatabasePath = join(testDirectory, 'auth.sqlite')
const chatDatabasePath = join(testDirectory, 'chat.sqlite')

process.env.AUTH_DB_PATH = authDatabasePath
process.env.CHAT_DB_PATH = chatDatabasePath
process.env.CHAT_TAG_HMAC_SECRET =
  'vitest-chat-tag-secret-that-is-at-least-32-characters'
process.env.CHAT_ENABLED = 'true'

function migrate(script: string, environment: NodeJS.ProcessEnv): void {
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: environment,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${script} failed`)
  }
}

describe('durable Chat messages', () => {
  beforeAll(async () => {
    migrate('scripts/migrate.mjs', {
      ...process.env,
      AUTH_DB_PATH: authDatabasePath,
    })
    migrate('scripts/migrate-chat.mjs', {
      ...process.env,
      CHAT_DB_PATH: chatDatabasePath,
    })

    const { getDatabase } = await import('@/lib/auth/database')
    const database = getDatabase()
    const now = Date.now()
    database
      .prepare(
        `INSERT INTO user (
          id, name, email, emailVerified, createdAt, updatedAt,
          username, displayUsername, role, banned, activationStatus, activatedAt
        ) VALUES
          ('admin-id', 'Administrator', 'admin@example.test', 0, ?, ?,
           'admin', 'admin', 'admin', 0, 'active', ?),
          ('owner-id', 'Channel Owner', 'owner@example.test', 0, ?, ?,
           'owner', 'owner', 'user', 0, 'active', ?),
          ('viewer-id', 'Original Name', 'viewer@example.test', 0, ?, ?,
           'viewer', 'viewer', 'user', 0, 'active', ?)` ,
      )
      .run(now, now, now, now, now, now, now, now, now)
    database
      .prepare(
        `INSERT INTO channel (
          id, owner_user_id, slug, media_path, display_name, title,
          description, accent_color, preferred_playback, enabled,
          created_at, updated_at, created_by
        ) VALUES (
          'stable-channel-id', 'owner-id', 'live', 'live', 'Live', 'Live',
          NULL, '#8b5cf6', 'hls', 1, ?, ?, 'admin-id'
        )`,
      )
      .run(now, now)
  })

  afterAll(async () => {
    const { getDatabase } = await import('@/lib/auth/database')
    const { getChatDatabase } = await import('@/lib/chat-database')
    getDatabase().close()
    getChatDatabase().close()
    vi.unstubAllGlobals()
    rmSync(testDirectory, { recursive: true, force: true })
  })

  it('migrates a dedicated database without adding Chat tables to auth', () => {
    const authDatabase = new Database(authDatabasePath, { readonly: true })
    const chatDatabase = new Database(chatDatabasePath, { readonly: true })

    expect(
      authDatabase
        .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'chat_%'")
        .all(),
    ).toEqual([])
    expect(
      chatDatabase
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'chat_%' ORDER BY name",
        )
        .all(),
    ).toEqual([
      { name: 'chat_message' },
      { name: 'chat_participant' },
      { name: 'chat_room' },
    ])

    authDatabase.close()
    chatDatabase.close()
  })

  it('commits a message and reloads its safe public representation', async () => {
    const { sendChatMessage, loadLatestChatMessages } = await import('@/lib/chat')
    const channel = {
      id: 'stable-channel-id',
      ownerUserId: 'owner-id',
    }
    const accepted = sendChatMessage({
      channel,
      participant: {
        accountId: 'viewer-id',
        profileName: 'Original Name',
      },
      rawContent: '  hello\nhttps://example.test  ',
      now: new Date('2026-09-11T10:00:00.000Z'),
    })

    const committedDatabase = new Database(chatDatabasePath, { readonly: true })
    expect(
      committedDatabase
        .prepare('SELECT content FROM chat_message WHERE id = ?')
        .get(accepted.id),
    ).toEqual({ content: 'hello https://example.test' })
    committedDatabase.close()

    const { getDatabase } = await import('@/lib/auth/database')
    getDatabase()
      .prepare("UPDATE user SET name = 'Renamed Viewer', role = 'admin' WHERE id = 'viewer-id'")
      .run()

    expect(loadLatestChatMessages(channel)).toEqual([
      {
        id: accepted.id,
        sequence: 1,
        content: 'hello https://example.test',
        profileName: 'Original Name',
        authorTag: accepted.authorTag,
        badges: ['admin'],
        serverTimestamp: '2026-09-11T10:00:00.000Z',
      },
    ])
  })

  it('keeps one room across publishing restarts and returns only the latest 100', async () => {
    const { sendChatMessage, loadLatestChatMessages } = await import('@/lib/chat')
    const { getChatDatabase } = await import('@/lib/chat-database')
    const channel = {
      id: 'stable-channel-id',
      ownerUserId: 'owner-id',
    }

    for (let index = 0; index < 101; index += 1) {
      sendChatMessage({
        channel,
        participant: {
          accountId: 'owner-id',
          profileName: 'Channel Owner',
        },
        rawContent: `message ${index}`,
        now: new Date(1_800_000_000_000 + index),
        messageId: randomUUID(),
      })
    }

    expect(
      getChatDatabase()
        .prepare('SELECT COUNT(*) AS count FROM chat_room WHERE channel_id = ?')
        .get(channel.id),
    ).toEqual({ count: 1 })

    const messages = loadLatestChatMessages(channel)
    expect(messages).toHaveLength(100)
    expect(messages[0]).toMatchObject({
      sequence: 3,
      content: 'message 1',
      profileName: 'Channel Owner',
      badges: ['owner'],
    })
    expect(messages.at(-1)).toMatchObject({
      sequence: 102,
      content: 'message 100',
    })
  })

  it('checks active-account and live-Channel access at the HTTP boundary', async () => {
    const { GET, POST } = await import(
      '@/app/api/channels/[slug]/chat/messages/route'
    )
    const { getDatabase } = await import('@/lib/auth/database')
    const { getChatDatabase } = await import('@/lib/chat-database')
    const context = { params: Promise.resolve({ slug: 'live' }) }
    const request = () =>
      new Request('http://localhost/api/channels/live/chat/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'access-checked message' }),
      })
    const liveResponse = () =>
      new Response(
        JSON.stringify({
          name: 'live',
          ready: true,
          tracks: [],
          readers: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    vi.stubGlobal('fetch', vi.fn().mockImplementation(liveResponse))

    expect((await GET(new Request('http://localhost'), context)).status).toBe(200)

    getDatabase()
      .prepare("UPDATE user SET activationStatus = 'pending' WHERE id = 'viewer-id'")
      .run()
    expect((await GET(new Request('http://localhost'), context)).status).toBe(401)

    getDatabase()
      .prepare("UPDATE user SET activationStatus = 'disabled' WHERE id = 'viewer-id'")
      .run()
    expect((await POST(request(), context)).status).toBe(401)

    getDatabase()
      .prepare("UPDATE user SET activationStatus = 'active' WHERE id = 'viewer-id'")
      .run()
    const countBefore = getChatDatabase()
      .prepare('SELECT COUNT(*) AS count FROM chat_message')
      .get() as { count: number }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))

    expect((await POST(request(), context)).status).toBe(409)
    expect(
      getChatDatabase()
        .prepare('SELECT COUNT(*) AS count FROM chat_message')
        .get(),
    ).toEqual(countBefore)
  })
})
