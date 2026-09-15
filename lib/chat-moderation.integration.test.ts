// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const session = vi.hoisted(() => ({ accountId: 'owner' as string | null }))
vi.mock('@/lib/auth/session', () => ({
  getActiveSession: async () =>
    session.accountId ? { user: { id: session.accountId } } : null,
}))
vi.mock('@/lib/mediamtx', () => ({
  getChannelStatus: async () => ({ live: true }),
}))
process.env.CHAT_ENABLED = 'true'

const directory = mkdtempSync(join(tmpdir(), 'chat-removal-'))
process.env.AUTH_DB_PATH = join(directory, 'auth.sqlite')
process.env.CHAT_DB_PATH = join(directory, 'chat.sqlite')
process.env.CHAT_TAG_HMAC_SECRET =
  'test-chat-removal-secret-with-at-least-32-characters'
const channel = { id: 'room-channel', ownerUserId: 'owner' }

beforeAll(async () => {
  for (const script of ['scripts/migrate.mjs', 'scripts/migrate-chat.mjs']) {
    const result = spawnSync(process.execPath, [script], { env: process.env })
    expect(result.status, result.stderr.toString()).toBe(0)
  }
  const { getDatabase } = await import('@/lib/auth/database')
  for (const id of ['admin', 'owner', 'participant']) {
    getDatabase()
      .prepare(
        `INSERT INTO user
      (id, name, email, emailVerified, createdAt, updatedAt, role, activationStatus)
      VALUES (?, ?, ?, 0, 0, 0, ?, 'active')`,
      )
      .run(id, id, `${id}@test.invalid`, id === 'admin' ? 'admin' : 'user')
  }
  getDatabase()
    .prepare(
      `INSERT INTO channel (id, owner_user_id, slug, media_path, display_name, title, enabled, created_at, updated_at, created_by)
    VALUES ('http-channel', 'owner', 'moderation', 'moderation', 'Moderation', 'Moderation', 1, 0, 0, 'admin')`,
    )
    .run()
})
afterAll(async () => {
  const { getDatabase } = await import('@/lib/auth/database')
  const { getChatDatabase } = await import('@/lib/chat-database')
  getDatabase().close()
  getChatDatabase().close()
  rmSync(directory, { recursive: true, force: true })
})

it('removes content atomically and exposes only a tombstone in history and delivery', async () => {
  const { sendChatMessage, loadLatestChatHistory, loadChatMessagesAfter } =
    await import('@/lib/chat')
  const { removeChatMessage, inspectRemovedChatMessage } =
    await import('@/lib/chat-moderation')
  const { dispatchNextChatOutboxEvent } = await import('@/lib/chat-outbox')
  const message = sendChatMessage({
    channel,
    participant: { accountId: 'participant', profileName: 'Private author' },
    rawContent: 'harmful content',
  })
  const removed = removeChatMessage({
    channel,
    actorId: 'owner',
    messageId: message.id,
    category: 'Other',
    note: 'Private evidence',
  })
  expect(removed).toEqual({
    id: message.id,
    sequence: message.sequence,
    revisionSequence: message.sequence + 1,
    serverTimestamp: message.serverTimestamp,
    removed: true,
  })
  expect(loadLatestChatHistory(channel).messages).toEqual([removed])
  expect(loadChatMessagesAfter(channel, message.sequence).messages).toEqual([
    removed,
  ])
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ result: {} }))
  while (await dispatchNextChatOutboxEvent(fetcher)) {
    /* drain committed events */
  }
  expect(fetcher).toHaveBeenCalled()
  expect(String(fetcher.mock.calls[0][0])).toContain('/history_remove')
  for (const [url, options] of fetcher.mock.calls) {
    if (!String(url).endsWith('/publish')) continue
    const payload = JSON.parse(String(options?.body))
    expect(payload.data.message).toEqual(removed)
    expect(JSON.stringify(payload)).not.toMatch(
      /Private|harmful|participant|owner/,
    )
  }
  expect(inspectRemovedChatMessage(channel, 'owner', message.id)).toMatchObject(
    { content: 'harmful content', category: 'Other', note: 'Private evidence' },
  )
  expect(() =>
    inspectRemovedChatMessage(channel, 'participant', message.id),
  ).toThrow('Not authorized')
})

it.each([
  ['admin', 'participant', channel, true],
  ['admin', 'owner', channel, true],
  ['admin', 'admin', channel, true],
  ['owner', 'participant', channel, true],
  ['participant', 'participant', channel, false],
  ['owner', 'admin', channel, false],
  [
    'owner',
    'participant',
    { id: 'another-channel', ownerUserId: 'participant' },
    false,
  ],
] as const)(
  'checks removal authority for %s against %s',
  async (actorId, targetId, targetChannel, allowed) => {
    const { sendChatMessage } = await import('@/lib/chat')
    const { removeChatMessage } = await import('@/lib/chat-moderation')
    const { getChatDatabase } = await import('@/lib/chat-database')
    getChatDatabase()
      .prepare('UPDATE chat_participant SET next_send_time = 0')
      .run()
    // Each scenario uses its own room so rate limits do not affect authorization.
    const ownChannel = { ...channel, id: crypto.randomUUID() }
    const message = sendChatMessage({
      channel: ownChannel,
      participant: { accountId: targetId, profileName: targetId },
      rawContent: 'content',
    })
    const remove = () =>
      removeChatMessage({
        channel: targetChannel === channel ? ownChannel : targetChannel,
        actorId,
        messageId: message.id,
        category: 'Spam',
      })
    if (allowed) expect(remove().removed).toBe(true)
    else expect(remove).toThrow('Not authorized')
  },
)

it('rolls back removal and its record when the outbox insert fails', async () => {
  const { sendChatMessage, loadLatestChatHistory } = await import('@/lib/chat')
  const { removeChatMessage, inspectRemovedChatMessage } =
    await import('@/lib/chat-moderation')
  const { getChatDatabase } = await import('@/lib/chat-database')
  const testChannel = { ...channel, id: 'rollback-channel' }
  const message = sendChatMessage({
    channel: testChannel,
    participant: { accountId: 'participant', profileName: 'Author' },
    rawContent: 'retained',
  })
  const database = getChatDatabase()
  database.exec(
    "CREATE TRIGGER reject_removal BEFORE INSERT ON chat_outbox BEGIN SELECT RAISE(ABORT, 'outbox failed'); END",
  )
  try {
    expect(() =>
      removeChatMessage({
        channel: testChannel,
        actorId: 'admin',
        messageId: message.id,
        category: 'Spam',
      }),
    ).toThrow('outbox failed')
  } finally {
    database.exec('DROP TRIGGER reject_removal')
  }
  expect(loadLatestChatHistory(testChannel).messages).toEqual([message])
  expect(() =>
    inspectRemovedChatMessage(testChannel, 'admin', message.id),
  ).toThrow('Removed message not found')
  expect(
    database
      .prepare('SELECT * FROM chat_moderation_record WHERE message_id = ?')
      .all(message.id),
  ).toEqual([])
  expect(
    removeChatMessage({
      channel: testChannel,
      actorId: 'admin',
      messageId: message.id,
      category: 'Spam',
    }).revisionSequence,
  ).toBe(2)
})

it('validates Other notes, deduplicates removal, and checks current access to retained evidence', async () => {
  const { sendChatMessage, loadOlderChatMessages } = await import('@/lib/chat')
  const { removeChatMessage, inspectRemovedChatMessage } =
    await import('@/lib/chat-moderation')
  const { getDatabase } = await import('@/lib/auth/database')
  const testChannel = { ...channel, id: 'notes-channel' }
  const now = new Date()
  const message = sendChatMessage({
    channel: testChannel,
    participant: { accountId: 'participant', profileName: 'Author' },
    rawContent: 'evidence',
    now,
  })
  const input = {
    channel: testChannel,
    actorId: 'owner',
    messageId: message.id,
    category: 'Other',
    now,
  }
  expect(() => removeChatMessage({ ...input, note: '  ' })).toThrow(
    'Other requires',
  )
  const removed = removeChatMessage({ ...input, note: 'reason' })
  expect(removeChatMessage({ ...input, note: 'different retry' })).toEqual(
    removed,
  )
  expect(
    loadOlderChatMessages(testChannel, 'chat-history-v1:100').messages,
  ).toEqual([removed])
  expect(() =>
    inspectRemovedChatMessage(
      { ...testChannel, id: 'wrong-room' },
      'admin',
      message.id,
    ),
  ).toThrow('Message not found')
  expect(() =>
    inspectRemovedChatMessage(
      testChannel,
      'admin',
      message.id,
      new Date(now.getTime() + 8 * 86400000),
    ),
  ).toThrow('Message not found')
  getDatabase()
    .prepare("UPDATE user SET activationStatus = 'pending' WHERE id = 'owner'")
    .run()
  try {
    expect(() =>
      inspectRemovedChatMessage(testChannel, 'owner', message.id),
    ).toThrow('Not authorized')
  } finally {
    getDatabase()
      .prepare("UPDATE user SET activationStatus = 'active' WHERE id = 'owner'")
      .run()
  }
})

it('protects removal and private evidence through authenticated HTTP requests', async () => {
  const { sendChatMessage } = await import('@/lib/chat')
  const { GET, POST } =
    await import('@/app/api/channels/[slug]/chat/messages/[messageId]/removal/route')
  const { GET: history } =
    await import('@/app/api/channels/[slug]/chat/messages/route')
  const httpChannel = { ...channel, id: 'http-channel' }
  const key = crypto.randomUUID()
  const message = sendChatMessage({
    channel: httpChannel,
    participant: { accountId: 'participant', profileName: 'Original author' },
    rawContent: 'Secret original',
    clientIdempotencyKey: key,
  })
  const context = {
    params: Promise.resolve({ slug: 'moderation', messageId: message.id }),
  }
  const url =
    'http://localhost/api/channels/moderation/chat/messages/' +
    message.id +
    '/removal'
  const remove = (body: unknown) =>
    POST(
      new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      context,
    )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({}, { status: 503 })),
  )
  try {
    session.accountId = 'participant'
    expect((await remove({ category: 'Spam' })).status).toBe(403)
    session.accountId = 'owner'
    expect((await remove({ category: 'Other', note: '  ' })).status).toBe(400)
    expect(
      (await remove({ category: 'Harassment', note: 'Private note' })).status,
    ).toBe(200)
    const privateResponse = await GET(new Request(url), context)
    expect(privateResponse.headers.get('cache-control')).toContain('no-store')
    expect(await privateResponse.json()).toMatchObject({
      content: 'Secret original',
      note: 'Private note',
    })
    session.accountId = 'participant'
    const rejected = await GET(new Request(url), context)
    expect(rejected.status).toBe(403)
    expect(await rejected.text()).not.toMatch(/Secret|Private|Original|owner/)
    for (const query of ['', '?before=chat-history-v1:100', '?after=1']) {
      const response = await history(new Request('http://localhost/' + query), {
        params: Promise.resolve({ slug: 'moderation' }),
      })
      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).toContain('"removed":true')
      expect(text).not.toMatch(/Secret|Private|Original|owner|participant/)
    }
    expect(
      sendChatMessage({
        channel: httpChannel,
        participant: {
          accountId: 'participant',
          profileName: 'Original author',
        },
        rawContent: 'Secret original',
        clientIdempotencyKey: key,
      }).removed,
    ).toBe(true)
    session.accountId = null
    expect((await GET(new Request(url), context)).status).toBe(401)
  } finally {
    vi.unstubAllGlobals()
    session.accountId = 'owner'
  }
})

it('keeps a disabled administrator immune to Channel-owner removal', async () => {
  const { sendChatMessage } = await import('@/lib/chat')
  const { removeChatMessage, getChatMessageActions } =
    await import('@/lib/chat-moderation')
  const { getDatabase } = await import('@/lib/auth/database')
  const testChannel = { ...channel, id: 'disabled-admin-channel' }
  const message = sendChatMessage({
    channel: testChannel,
    participant: { accountId: 'admin', profileName: 'Admin' },
    rawContent: 'administrator message',
  })
  getDatabase()
    .prepare("UPDATE user SET activationStatus = 'disabled' WHERE id = 'admin'")
    .run()
  try {
    expect(getChatMessageActions(testChannel, 'owner', message.id)).toEqual({
      canRemove: false,
      canInspect: false,
    })
    expect(() =>
      removeChatMessage({
        channel: testChannel,
        actorId: 'owner',
        messageId: message.id,
        category: 'Spam',
      }),
    ).toThrow('Not authorized')
  } finally {
    getDatabase()
      .prepare("UPDATE user SET activationStatus = 'active' WHERE id = 'admin'")
      .run()
  }
})
