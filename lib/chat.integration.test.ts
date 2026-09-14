// @vitest-environment node

import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const sessionState = vi.hoisted(() => ({
  accountId: 'viewer-id' as string | null,
}))

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
           'viewer', 'viewer', 'user', 0, 'active', ?)`,
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
      { name: 'chat_outbox' },
      { name: 'chat_participant' },
      { name: 'chat_room' },
    ])

    authDatabase.close()
    chatDatabase.close()
  })

  it('commits a message and reloads its safe public representation', async () => {
    const { sendChatMessage, loadLatestChatHistory } =
      await import('@/lib/chat')
    const { getChatDatabase } = await import('@/lib/chat-database')
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
      .prepare(
        "UPDATE user SET name = 'Renamed Viewer', role = 'admin' WHERE id = 'viewer-id'",
      )
      .run()

    expect(
      loadLatestChatHistory(channel, new Date('2026-09-11T10:00:00.000Z')),
    ).toEqual({
      messages: [
        {
          id: accepted.id,
          submissionId: accepted.submissionId,
          sequence: 1,
          content: 'hello https://example.test',
          profileName: 'Original Name',
          authorTag: accepted.authorTag,
          badges: ['admin'],
          serverTimestamp: '2026-09-11T10:00:00.000Z',
        },
      ],
      hasMore: false,
      cursor: null,
    })

    expect(
      getChatDatabase()
        .prepare(
          `SELECT message_id AS messageId, channel_name AS channelName,
                  attempt_count AS attemptCount
           FROM chat_outbox WHERE message_id = ?`,
        )
        .get(accepted.id),
    ).toEqual({
      messageId: accepted.id,
      channelName: 'chat:stable-channel-id',
      attemptCount: 0,
    })
  })

  it('loads all committed messages after a room sequence for gap repair', async () => {
    const { loadChatMessagesAfter, sendChatMessage } =
      await import('@/lib/chat')
    const channel = {
      id: 'gap-channel-id',
      ownerUserId: 'owner-id',
    }
    const first = sendChatMessage({
      channel,
      participant: { accountId: 'viewer-id', profileName: 'Original Name' },
      rawContent: 'gap repair one',
    })
    const second = sendChatMessage({
      channel,
      participant: { accountId: 'viewer-id', profileName: 'Original Name' },
      rawContent: 'gap repair two',
    })

    expect(loadChatMessagesAfter(channel, first.sequence)).toEqual({
      messages: [expect.objectContaining({ id: second.id })],
      hasMore: false,
    })
  })

  it('retries an outbox publication with one stable Centrifugo idempotency key', async () => {
    const { sendChatMessage } = await import('@/lib/chat')
    const { getChatDatabase } = await import('@/lib/chat-database')
    const { dispatchNextChatOutboxEvent } = await import('@/lib/chat-outbox')
    const database = getChatDatabase()
    database.prepare('DELETE FROM chat_outbox').run()
    const accepted = sendChatMessage({
      channel: { id: 'outbox-channel-id', ownerUserId: 'owner-id' },
      participant: { accountId: 'viewer-id', profileName: 'Original Name' },
      rawContent: 'retry this publication',
      now: new Date('2026-09-11T10:00:00.000Z'),
    })
    const calls: Array<{ idempotency_key: string }> = []
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (_input, init) => {
        calls.push(JSON.parse(String(init?.body)))
        return Response.json(
          { error: { code: 500, message: 'temporary' } },
          { status: 503 },
        )
      })
      .mockImplementationOnce(async (_input, init) => {
        calls.push(JSON.parse(String(init?.body)))
        return Response.json({ result: { offset: 1, epoch: 'test' } })
      })

    await expect(
      dispatchNextChatOutboxEvent(
        fetcher,
        new Date('2026-09-11T10:00:00.000Z'),
      ),
    ).resolves.toBe(false)
    const pending = database
      .prepare(
        `SELECT id, attempt_count AS attemptCount, next_attempt_at AS nextAttemptAt
         FROM chat_outbox WHERE message_id = ?`,
      )
      .get(accepted.id) as {
      id: string
      attemptCount: number
      nextAttemptAt: number
    }
    expect(pending.attemptCount).toBe(1)
    expect(pending.nextAttemptAt).toBeGreaterThan(1_789_120_800_000)

    await expect(
      dispatchNextChatOutboxEvent(fetcher, new Date(pending.nextAttemptAt)),
    ).resolves.toBe(true)
    expect(calls).toEqual([
      expect.objectContaining({ idempotency_key: pending.id }),
      expect.objectContaining({ idempotency_key: pending.id }),
    ])
    expect(
      database
        .prepare('SELECT id FROM chat_outbox WHERE message_id = ?')
        .get(accepted.id),
    ).toBeUndefined()
  })

  it('shares the sending limit across requests and retries a committed message without another slot', async () => {
    const { sendChatMessage, loadLatestChatHistory } =
      await import('@/lib/chat')
    const { ChatRateLimitError } = await import('@/lib/chat-rules')
    const channel = { id: 'limited-room', ownerUserId: 'owner-id' }
    const input = {
      channel,
      participant: { accountId: 'viewer-id', profileName: 'Viewer' },
      rawContent: 'one submission',
      now: new Date(20_000),
      clientIdempotencyKey: randomUUID(),
    }
    const first = sendChatMessage(input)
    sendChatMessage({ ...input, clientIdempotencyKey: randomUUID() })
    sendChatMessage({ ...input, clientIdempotencyKey: randomUUID() })
    expect(() =>
      sendChatMessage({ ...input, clientIdempotencyKey: randomUUID() }),
    ).toThrow(ChatRateLimitError)
    expect(sendChatMessage(input)).toEqual(first)
    expect(loadLatestChatHistory(channel, input.now).messages).toHaveLength(3)
    expect(() =>
      sendChatMessage({
        ...input,
        rawContent: 'changed',
        now: new Date(22_000),
      }),
    ).toThrow('Retry must use the original message.')
    expect(
      sendChatMessage({
        ...input,
        clientIdempotencyKey: randomUUID(),
        now: new Date(22_000),
      }).sequence,
    ).toBe(4)
    expect(
      sendChatMessage({
        ...input,
        participant: { accountId: 'owner-id', profileName: 'Owner' },
      }).sequence,
    ).toBe(5)
    expect(
      sendChatMessage({ ...input, channel: { ...channel, id: 'another-room' } })
        .sequence,
    ).toBe(1)
  })

  it('keeps one room across publishing restarts and returns only the latest 100', async () => {
    const { sendChatMessage, loadLatestChatHistory } =
      await import('@/lib/chat')
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
        now: new Date(1_800_000_000_000 + index * 2_000),
        messageId: randomUUID(),
      })
    }

    expect(
      getChatDatabase()
        .prepare('SELECT COUNT(*) AS count FROM chat_room WHERE channel_id = ?')
        .get(channel.id),
    ).toEqual({ count: 1 })

    const page = loadLatestChatHistory(channel, new Date(1_800_000_200_000))
    expect(page.messages).toHaveLength(100)
    expect(page.messages[0]).toMatchObject({
      sequence: 3,
      content: 'message 1',
      profileName: 'Channel Owner',
      badges: ['owner'],
    })
    expect(page.messages.at(-1)).toMatchObject({
      sequence: 102,
      content: 'message 100',
    })
    expect(page.hasMore).toBe(true)
    expect(page.cursor).toBe('chat-history-v1:3')
  })

  it('pages tied timestamps and a content-free tombstone through a stable cursor while new messages arrive', async () => {
    const { loadLatestChatHistory, loadOlderChatMessages, sendChatMessage } =
      await import('@/lib/chat')
    const { getChatDatabase } = await import('@/lib/chat-database')
    const channel = { id: 'history-channel-id', ownerUserId: 'owner-id' }
    const baseTime = 1_800_000_000_000
    const retentionCutoff = baseTime - 7 * 24 * 60 * 60 * 1000
    const expired = sendChatMessage({
      channel,
      participant: { accountId: 'viewer-id', profileName: 'Original Name' },
      rawContent: 'expired history',
      now: new Date(retentionCutoff - 1),
      messageId: randomUUID(),
    })
    const retained = Array.from({ length: 205 }, (_, index) =>
      sendChatMessage({
        channel,
        participant: {
          accountId: `history-viewer-${index}`,
          profileName: 'Original Name',
        },
        rawContent: `history message ${index + 1}`,
        now: new Date(baseTime),
        messageId: randomUUID(),
      }),
    )
    const tombstoneId = retained[1].id
    getChatDatabase()
      .prepare(
        `UPDATE chat_message
         SET profile_name = '', author_tag = '', content = ''
         WHERE id = ?`,
      )
      .run(tombstoneId)

    const future = sendChatMessage({
      channel,
      participant: { accountId: 'viewer-id', profileName: 'Original Name' },
      rawContent: 'future history',
      now: new Date(baseTime + 1),
      messageId: randomUUID(),
    })

    const latest = loadLatestChatHistory(channel, new Date(baseTime))
    expect(latest.messages.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 107),
    )
    expect(latest).toMatchObject({
      hasMore: true,
      cursor: 'chat-history-v1:107',
    })

    const concurrent = sendChatMessage({
      channel,
      participant: { accountId: 'viewer-id', profileName: 'Original Name' },
      rawContent: 'concurrent new message',
      now: new Date(baseTime + 1),
      messageId: randomUUID(),
    })
    const older = loadOlderChatMessages(
      channel,
      latest.cursor!,
      new Date(baseTime),
    )
    expect(older.messages.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 7),
    )
    expect(older).toMatchObject({
      hasMore: true,
      cursor: 'chat-history-v1:7',
    })

    const oldest = loadOlderChatMessages(
      channel,
      older.cursor!,
      new Date(baseTime),
    )
    expect(oldest.messages.map(({ sequence }) => sequence)).toEqual([
      2, 3, 4, 5, 6,
    ])
    expect(oldest.hasMore).toBe(false)
    expect(oldest.cursor).toBeNull()

    const returnedMessages = [
      ...oldest.messages,
      ...older.messages,
      ...latest.messages,
    ]
    const returnedIds = returnedMessages.map(({ id }) => id)
    expect(returnedIds).not.toContain(expired.id)
    expect(returnedIds).not.toContain(future.id)
    expect(returnedIds).not.toContain(concurrent.id)
    expect(returnedIds).toEqual(retained.map(({ id }) => id))
    expect(returnedMessages.find(({ id }) => id === tombstoneId)).toMatchObject(
      {
        content: '',
        profileName: '',
        authorTag: '',
      },
    )
  })

  it('accepts HTTP sends during delivery failure and enforces one shared limit across concurrent requests', async () => {
    const { POST, GET } =
      await import('@/app/api/channels/[slug]/chat/messages/route')
    const { getChatDatabase } = await import('@/lib/chat-database')
    const { dispatchNextChatOutboxEvent } = await import('@/lib/chat-outbox')
    const database = getChatDatabase()
    database
      .prepare("DELETE FROM chat_room WHERE channel_id = 'stable-channel-id'")
      .run()
    database.prepare('DELETE FROM chat_outbox').run()
    const context = { params: Promise.resolve({ slug: 'live' }) }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        String(url).includes('/v3/paths/')
          ? Response.json({
              name: 'live',
              ready: true,
              tracks: [],
              readers: [],
            })
          : Response.json({}, { status: 503 }),
      ),
    )
    const send = (key: string) =>
      POST(
        new Request('http://localhost/api/channels/live/chat/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            content: 'durable despite delivery failure',
            clientIdempotencyKey: key,
          }),
        }),
        context,
      )
    const key = randomUUID()
    const responses = await Promise.all([
      send(key),
      send(randomUUID()),
      send(randomUUID()),
      send(randomUUID()),
    ])
    expect(responses.map((response) => response.status)).toEqual([
      201, 201, 201, 429,
    ])
    const first = await responses[0].json()
    expect(await (await send(key)).json()).toEqual(first)
    await expect(
      dispatchNextChatOutboxEvent(async () =>
        Response.json({}, { status: 503 }),
      ),
    ).resolves.toBe(false)
    const history = await (
      await GET(new Request('http://localhost'), context)
    ).json()
    expect(history.messages).toHaveLength(3)
    expect(history.messages[0].id).toBe(first.message.id)
    expect(JSON.stringify(history)).not.toContain(key)

    database.pragma('query_only = ON')
    try {
      expect((await send(randomUUID())).status).toBe(503)
      expect((await GET(new Request('http://localhost'), context)).status).toBe(
        200,
      )
    } finally {
      database.pragma('query_only = OFF')
    }
  })

  it('rolls back the message, retry key, and rate slot if its outbox event cannot commit', async () => {
    const { sendChatMessage, loadLatestChatHistory } =
      await import('@/lib/chat')
    const { getChatDatabase } = await import('@/lib/chat-database')
    const database = getChatDatabase()
    const input = {
      channel: { id: 'atomic-room', ownerUserId: 'owner-id' },
      participant: { accountId: 'viewer-id', profileName: 'Viewer' },
      rawContent: 'atomic send',
      clientIdempotencyKey: randomUUID(),
    }
    database.exec(
      "CREATE TRIGGER fail_outbox BEFORE INSERT ON chat_outbox BEGIN SELECT RAISE(ABORT, 'outbox failed'); END",
    )
    try {
      expect(() => sendChatMessage(input)).toThrow('outbox failed')
      expect(loadLatestChatHistory(input.channel).messages).toEqual([])
    } finally {
      database.exec('DROP TRIGGER fail_outbox')
    }
    expect(sendChatMessage(input).sequence).toBe(1)
    sendChatMessage({ ...input, clientIdempotencyKey: randomUUID() })
    sendChatMessage({ ...input, clientIdempotencyKey: randomUUID() })
    expect(loadLatestChatHistory(input.channel).messages).toHaveLength(3)
  })

  it('checks active-account and live-Channel access at the HTTP boundary', async () => {
    const { GET, POST } =
      await import('@/app/api/channels/[slug]/chat/messages/route')
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

    expect((await GET(new Request('http://localhost'), context)).status).toBe(
      200,
    )

    getDatabase()
      .prepare(
        "UPDATE user SET activationStatus = 'pending' WHERE id = 'viewer-id'",
      )
      .run()
    expect((await GET(new Request('http://localhost'), context)).status).toBe(
      401,
    )

    getDatabase()
      .prepare(
        "UPDATE user SET activationStatus = 'disabled' WHERE id = 'viewer-id'",
      )
      .run()
    expect((await POST(request(), context)).status).toBe(401)

    getDatabase()
      .prepare(
        "UPDATE user SET activationStatus = 'active' WHERE id = 'viewer-id'",
      )
      .run()
    const countBefore = getChatDatabase()
      .prepare('SELECT COUNT(*) AS count FROM chat_message')
      .get() as { count: number }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    )

    expect((await POST(request(), context)).status).toBe(409)
    expect(
      getChatDatabase()
        .prepare('SELECT COUNT(*) AS count FROM chat_message')
        .get(),
    ).toEqual(countBefore)
  })
})
