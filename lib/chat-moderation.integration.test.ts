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
      canTimeout: false,
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

it('times out sending, removes only the previous ten minutes, and restores sending at expiry', async () => {
  const { sendChatMessage, loadLatestChatHistory } = await import('@/lib/chat')
  const { applyChatTimeout } = await import('@/lib/chat-moderation')
  const { getChatRestriction } = await import('@/lib/chat-restrictions')
  const testChannel = { ...channel, id: 'timeout-channel' }
  const now = new Date('2026-09-15T12:00:00Z')
  const participant = { accountId: 'participant', profileName: 'Author' }
  const send = (content: string, time: Date) =>
    sendChatMessage({
      channel: testChannel,
      participant,
      rawContent: content,
      now: time,
    })
  const older = send(
    'older retained message',
    new Date('2026-09-15T11:49:59.999Z'),
  )
  const recent = send('recent message', new Date('2026-09-15T11:50:00Z'))
  applyChatTimeout({
    channel: testChannel,
    actorId: 'owner',
    messageId: recent.id,
    category: 'Other',
    note: 'Private evidence',
    durationMinutes: 10,
    now,
  })
  expect(getChatRestriction(testChannel.id, 'participant', now)).toEqual({
    category: 'Other',
    expiresAt: '2026-09-15T12:10:00.000Z',
  })
  expect(loadLatestChatHistory(testChannel, now).messages).toEqual([
    older,
    expect.objectContaining({ id: recent.id, removed: true }),
  ])
  expect(() => send('blocked', now)).toThrow('Chat timeout')
  expect(() =>
    send('still blocked', new Date('2026-09-15T12:09:59.999Z')),
  ).toThrow('Chat timeout')
  expect(
    getChatRestriction(
      testChannel.id,
      'participant',
      new Date('2026-09-15T12:10:00Z'),
    ),
  ).toBeNull()
  expect(send('restored', new Date('2026-09-15T12:10:00Z'))).toMatchObject({
    content: 'restored',
  })
})

it('returns private timeout state and rejects direct HTTP sends while allowing reading and connection tokens', async () => {
  const { sendChatMessage } = await import('@/lib/chat')
  const { POST } =
    await import('@/app/api/channels/[slug]/chat/messages/[messageId]/timeout/route')
  const { GET: state } =
    await import('@/app/api/channels/[slug]/chat/state/route')
  const { GET: history, POST: send } =
    await import('@/app/api/channels/[slug]/chat/messages/route')
  const { GET: token } =
    await import('@/app/api/channels/[slug]/chat/token/route')
  const message = sendChatMessage({
    channel: { ...channel, id: 'http-channel' },
    participant: { accountId: 'participant', profileName: 'Author' },
    rawContent: 'timeout target',
  })
  const params = Promise.resolve({ slug: 'moderation', messageId: message.id })
  const request = new Request('http://localhost/')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({}, { status: 503 })),
  )
  try {
    session.accountId = 'owner'
    const result = await POST(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          durationMinutes: 60,
          category: 'Other',
          note: 'Secret reason',
        }),
      }),
      { params },
    )
    expect(result.status).toBe(200)
    session.accountId = 'participant'
    const restrictionState = await state(request, { params })
    expect(restrictionState.status).toBe(200)
    expect(restrictionState.headers.get('cache-control')).toContain('no-store')
    const body = await restrictionState.json()
    expect(body.restriction).toEqual({
      category: 'Other',
      expiresAt: expect.any(String),
    })
    expect(JSON.stringify(body)).not.toMatch(
      /Secret|owner|participant|actor|note/,
    )
    const rejected = await send(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: 'bypass',
          clientIdempotencyKey: crypto.randomUUID(),
        }),
      }),
      { params },
    )
    expect(rejected.status).toBe(403)
    expect(await rejected.json()).toEqual({
      error: 'Chat timeout is active.',
      restriction: body.restriction,
    })
    expect((await history(request, { params })).status).toBe(200)
    expect((await token(request, { params })).status).toBe(200)
    session.accountId = null
    expect((await state(request, { params })).status).toBe(401)
  } finally {
    vi.unstubAllGlobals()
    session.accountId = 'owner'
  }
})

it.each([
  ['owner', 'participant', 'owner', true],
  ['owner', 'participant', 'participant', false],
  ['participant', 'participant', 'owner', false],
  ['owner', 'admin', 'owner', false],
  ['owner', 'owner', 'owner', false],
  ['admin', 'admin', 'admin', false],
  ['admin', 'owner', 'participant', true],
  ['admin', 'owner', 'owner', false],
  ['admin', 'participant', 'participant', false],
] as const)(
  'checks timeout authority for %s against %s in a room owned by %s',
  async (actorId, targetId, ownerUserId, allowed) => {
    const { sendChatMessage } = await import('@/lib/chat')
    const { applyChatTimeout } = await import('@/lib/chat-moderation')
    const testChannel = { id: crypto.randomUUID(), ownerUserId }
    const message = sendChatMessage({
      channel: testChannel,
      participant: { accountId: targetId, profileName: targetId },
      rawContent: 'target',
    })
    const timeout = () =>
      applyChatTimeout({
        channel: testChannel,
        actorId,
        messageId: message.id,
        durationMinutes: 10,
        category: 'Spam',
      })
    if (allowed)
      expect(timeout().messages).toEqual([
        expect.objectContaining({ removed: true }),
      ])
    else expect(timeout).toThrow('Not authorized')
  },
)

it.each([10, 60, 1440])(
  'records a %i minute timeout and delivers only tombstones publicly',
  async (durationMinutes) => {
    const { sendChatMessage } = await import('@/lib/chat')
    const { applyChatTimeout } = await import('@/lib/chat-moderation')
    const { getChatRestriction } = await import('@/lib/chat-restrictions')
    const { getChatDatabase } = await import('@/lib/chat-database')
    const { dispatchNextChatOutboxEvent } = await import('@/lib/chat-outbox')
    const testChannel = { ...channel, id: crypto.randomUUID() }
    const now = new Date()
    const message = sendChatMessage({
      channel: testChannel,
      participant: { accountId: 'participant', profileName: 'Private author' },
      rawContent: 'harmful',
      now,
    })
    applyChatTimeout({
      channel: testChannel,
      actorId: 'owner',
      messageId: message.id,
      durationMinutes,
      category: 'Spam',
      note: 'Private evidence',
      now,
    })
    expect(
      Date.parse(
        getChatRestriction(testChannel.id, 'participant', now)!.expiresAt!,
      ) - now.getTime(),
    ).toBe(durationMinutes * 60_000)
    const record = getChatDatabase()
      .prepare(
        `SELECT record.* FROM chat_moderation_record record JOIN chat_room room ON room.id = record.room_id WHERE room.channel_id = ? AND action = 'timeout'`,
      )
      .get(testChannel.id)
    expect(record).toMatchObject({
      actor_account_id: 'owner',
      target_account_id: 'participant',
      category: 'Spam',
      private_note: 'Private evidence',
      expires_at: now.getTime() + durationMinutes * 60_000,
    })
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ result: {} }),
    )
    while (
      await dispatchNextChatOutboxEvent(fetcher, new Date(Date.now() + 60_000))
    ) {
      /* drain */
    }
    const publications = fetcher.mock.calls
      .filter(([url]) => String(url).endsWith('/publish'))
      .map(([, options]) => JSON.parse(String(options?.body)))
    const publicEvents = publications.filter(
      ({ channel: name }) => name === `chat:${testChannel.id}`,
    )
    expect(publicEvents).toHaveLength(1)
    expect(publicEvents[0].data.message).toMatchObject({
      id: message.id,
      removed: true,
    })
    expect(JSON.stringify(publicEvents)).not.toMatch(
      /Private|harmful|owner|participant|timeout|Spam/,
    )
    expect(publications).toContainEqual(
      expect.objectContaining({
        channel: 'control:#participant',
        data: { type: 'restriction', channelId: testChannel.id },
      }),
    )
  },
)

it('rolls back the entire timeout when private event storage fails', async () => {
  const { sendChatMessage, loadLatestChatHistory } = await import('@/lib/chat')
  const { applyChatTimeout } = await import('@/lib/chat-moderation')
  const { getChatRestriction } = await import('@/lib/chat-restrictions')
  const { getChatDatabase } = await import('@/lib/chat-database')
  const database = getChatDatabase()
  const testChannel = { ...channel, id: crypto.randomUUID() }
  const participant = { accountId: 'participant', profileName: 'Author' }
  const message = sendChatMessage({
    channel: testChannel,
    participant,
    rawContent: 'retained',
  })
  database.exec(
    "CREATE TRIGGER reject_control BEFORE INSERT ON chat_outbox WHEN NEW.message_id IS NULL BEGIN SELECT RAISE(ABORT, 'control failed'); END",
  )
  try {
    expect(() =>
      applyChatTimeout({
        channel: testChannel,
        actorId: 'owner',
        messageId: message.id,
        durationMinutes: 10,
        category: 'Spam',
      }),
    ).toThrow('control failed')
  } finally {
    database.exec('DROP TRIGGER reject_control')
  }
  expect(getChatRestriction(testChannel.id, 'participant')).toBeNull()
  expect(loadLatestChatHistory(testChannel).messages).toEqual([message])
  expect(
    database
      .prepare(
        `SELECT record.id FROM chat_moderation_record record JOIN chat_room room ON room.id = record.room_id WHERE room.channel_id = ?`,
      )
      .all(testChannel.id),
  ).toEqual([])
  expect(
    sendChatMessage({
      channel: testChannel,
      participant,
      rawContent: 'still allowed',
    }),
  ).toMatchObject({ sequence: 2 })
})

it.each([
  { durationMinutes: 5, category: 'Spam' },
  { durationMinutes: 10, category: 'Other', note: '  ' },
  { durationMinutes: 10, category: 'Spam', note: 'x'.repeat(2001) },
  { durationMinutes: 10, category: 'Unknown' },
])('rejects invalid timeout options %#', async (options) => {
  const { applyChatTimeout } = await import('@/lib/chat-moderation')
  expect(() =>
    applyChatTimeout({
      channel,
      actorId: 'admin',
      messageId: 'any',
      ...options,
    }),
  ).toThrow('Select a timeout')
})

it('rejects concurrent sends that started before a timeout but reach storage after its commit', async () => {
  const { sendChatMessage, loadLatestChatHistory } = await import('@/lib/chat')
  const { applyChatTimeout } = await import('@/lib/chat-moderation')
  const { POST } = await import('@/app/api/channels/[slug]/chat/messages/route')
  const testChannel = { ...channel, id: 'http-channel' }
  const participant = { accountId: 'admin', profileName: 'Admin' }
  const key = crypto.randomUUID()
  const message = sendChatMessage({
    channel: testChannel,
    participant,
    rawContent: 'before timeout',
    clientIdempotencyKey: key,
  })
  session.accountId = 'admin'
  const releases: Array<() => void> = []
  const started: Array<Promise<void>> = []
  const requests = [
    {
      content: 'concurrent tab one',
      clientIdempotencyKey: crypto.randomUUID(),
    },
    {
      content: 'concurrent tab two',
      clientIdempotencyKey: crypto.randomUUID(),
    },
    { content: 'before timeout', clientIdempotencyKey: key },
  ].map((body) => {
    const reading = Promise.withResolvers<void>()
    started.push(reading.promise)
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          reading.resolve()
          return new Promise<void>((resolve) =>
            releases.push(() => {
              controller.enqueue(new TextEncoder().encode(JSON.stringify(body)))
              controller.close()
              resolve()
            }),
          )
        },
      },
      { highWaterMark: 0 },
    )
    return POST(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: stream,
        duplex: 'half',
      } as RequestInit),
      { params: Promise.resolve({ slug: 'moderation' }) },
    )
  })
  try {
    await Promise.all(started)
    applyChatTimeout({
      channel: testChannel,
      actorId: 'admin',
      messageId: message.id,
      durationMinutes: 10,
      category: 'Spam',
    })
  } finally {
    releases.forEach((release) => release())
  }
  try {
    const responses = await Promise.all(requests)
    expect(responses.map(({ status }) => status)).toEqual([403, 403, 403])
    expect(
      loadLatestChatHistory(testChannel).messages.some((entry) =>
        entry.content?.startsWith('concurrent'),
      ),
    ).toBe(false)
  } finally {
    session.accountId = 'owner'
  }
})

it('keeps a Chat ban indefinite and replaces only the previous ten minutes with tombstones', async () => {
  const { sendChatMessage, loadLatestChatHistory } = await import('@/lib/chat')
  const { applyChatBan, getChatParticipantState } =
    await import('@/lib/chat-moderation')
  const room = { ...channel, id: crypto.randomUUID() }
  const now = new Date()
  const participant = { accountId: 'participant', profileName: 'Author' }
  const older = sendChatMessage({
    channel: room,
    participant,
    rawContent: 'Older',
    now: new Date(now.getTime() - 600_001),
  })
  const recent = sendChatMessage({
    channel: room,
    participant,
    rawContent: 'Recent',
    now,
  })
  applyChatBan({
    channel: room,
    actorId: 'owner',
    messageId: recent.id,
    category: 'Other',
    note: 'Private reason',
    now,
  })
  const later = new Date(now.getTime() + 365 * 86400_000)
  expect(
    getChatParticipantState(room, 'participant', later).restriction,
  ).toEqual({ category: 'Other', expiresAt: null })
  expect(() =>
    sendChatMessage({
      channel: room,
      participant,
      rawContent: 'Bypass',
      now: later,
    }),
  ).toThrow('Chat ban')
  expect(loadLatestChatHistory(room, now).messages).toEqual([
    older,
    expect.objectContaining({ id: recent.id, removed: true }),
  ])
})

it('reverses a ban, restores sending, and keeps durable records after retention and clearing', async () => {
  const { sendChatMessage } = await import('@/lib/chat')
  const {
    applyChatBan,
    getChatParticipantState,
    listActiveChatRestrictions,
    reverseChatRestriction,
    listChatModerationRecords,
    clearChatModerationRecords,
  } = await import('@/lib/chat-moderation')
  const room = { ...channel, id: crypto.randomUUID() }
  const now = new Date()
  const message = sendChatMessage({
    channel: room,
    participant: { accountId: 'participant', profileName: 'Friend' },
    rawContent: 'Evidence',
    now,
  })
  applyChatBan({
    channel: room,
    actorId: 'admin',
    messageId: message.id,
    category: 'Other',
    note: 'Private note',
    now,
  })
  expect(
    getChatParticipantState(room, 'participant', now).moderatorRole,
  ).toBeNull()
  const [restriction] = listActiveChatRestrictions(room, 'admin', now)
  expect(restriction).toMatchObject({
    action: 'ban',
    canReverse: true,
    expiresAt: null,
  })
  expect(() =>
    reverseChatRestriction(room, 'owner', restriction.id, now),
  ).toThrow('Not authorized')
  const later = new Date(now.getTime() + 8 * 86400_000)
  const records = listChatModerationRecords('admin', undefined, later).records
  expect(records.find((record) => record.id === restriction.id)).toMatchObject({
    action: 'ban',
    state: 'active',
    category: 'Other',
  })
  expect(JSON.stringify(records)).not.toMatch(/Evidence|Private note/)
  clearChatModerationRecords('admin')
  expect(listChatModerationRecords('admin').records).toEqual([])
  expect(
    getChatParticipantState(room, 'participant', later).restriction,
  ).not.toBeNull()
  reverseChatRestriction(room, 'admin', restriction.id, later)
  expect(getChatParticipantState(room, 'participant', later)).toMatchObject({
    restriction: null,
    moderatorRole: null,
  })
  expect(
    sendChatMessage({
      channel: room,
      participant: { accountId: 'participant', profileName: 'Friend' },
      rawContent: 'Restored',
      now: later,
    }),
  ).toMatchObject({ content: 'Restored' })
  expect(listChatModerationRecords('admin', undefined, later).records).toEqual([
    expect.objectContaining({
      action: 'reversal',
      state: 'completed',
      sourceRecordId: restriction.id,
    }),
  ])
})

it.each([
  ['owner', 'participant', 'owner', true],
  ['owner', 'owner', 'owner', false],
  ['owner', 'admin', 'owner', false],
  ['owner', 'participant', 'participant', false],
  ['participant', 'owner', 'owner', false],
  ['participant', 'admin', 'owner', false],
  ['participant', 'participant', 'owner', false],
  ['admin', 'owner', 'owner', false],
  ['admin', 'admin', 'owner', true],
  ['admin', 'admin', 'admin', false],
  ['admin', 'owner', 'participant', true],
  ['admin', 'participant', 'participant', false],
] as const)(
  'checks ban authority for %s against %s in a room owned by %s',
  async (actorId, targetId, ownerUserId, allowed) => {
    const { sendChatMessage } = await import('@/lib/chat')
    const { applyChatBan } = await import('@/lib/chat-moderation')
    const room = { id: crypto.randomUUID(), ownerUserId }
    const message = sendChatMessage({
      channel: room,
      participant: { accountId: targetId, profileName: targetId },
      rawContent: 'Target',
    })
    const apply = () =>
      applyChatBan({
        channel: room,
        actorId,
        messageId: message.id,
        category: 'Spam',
      })
    if (allowed) expect(apply().messages).toHaveLength(1)
    else expect(apply).toThrow('Not authorized')
  },
)

it.each(['ban', 'timeout'] as const)(
  'enforces reversal authority and rejects stale %s reversals',
  async (action) => {
    const { sendChatMessage } = await import('@/lib/chat')
    const {
      applyChatBan,
      applyChatTimeout,
      listActiveChatRestrictions,
      reverseChatRestriction,
      getChatParticipantState,
    } = await import('@/lib/chat-moderation')
    for (const creator of ['owner', 'admin']) {
      for (const actor of ['owner', 'admin', 'participant']) {
        const room = { ...channel, id: crypto.randomUUID() }
        const message = sendChatMessage({
          channel: room,
          participant: { accountId: 'participant', profileName: 'Friend' },
          rawContent: 'Target',
        })
        const input = {
          channel: room,
          actorId: creator,
          messageId: message.id,
          category: 'Spam',
        }
        if (action === 'ban') applyChatBan(input)
        else applyChatTimeout({ ...input, durationMinutes: 10 })
        const [restriction] = listActiveChatRestrictions(room, 'admin')
        const reverse = () =>
          reverseChatRestriction(room, actor, restriction.id)
        const allowed =
          actor === 'admin' || (actor === 'owner' && creator === 'owner')
        if (allowed) {
          reverse()
          expect(
            getChatParticipantState(room, 'participant').restriction,
          ).toBeNull()
          expect(reverse).toThrow('not found')
        } else expect(reverse).toThrow('Not authorized')
        expect(() =>
          reverseChatRestriction(
            { ...room, id: 'wrong-room' },
            'admin',
            restriction.id,
          ),
        ).toThrow('not found')
      }
    }
  },
)

it('keeps moderation history administrator-only and pages stable records across rooms', async () => {
  const { sendChatMessage } = await import('@/lib/chat')
  const {
    applyChatBan,
    listChatModerationRecords,
    clearChatModerationRecords,
  } = await import('@/lib/chat-moderation')
  clearChatModerationRecords('admin')
  for (let i = 0; i < 26; i++) {
    const room = { ...channel, id: crypto.randomUUID() }
    const message = sendChatMessage({
      channel: room,
      participant: { accountId: 'participant', profileName: 'Friend' },
      rawContent: 'Private content',
    })
    applyChatBan({
      channel: room,
      actorId: 'owner',
      messageId: message.id,
      category: 'Spam',
    })
  }
  const first = listChatModerationRecords('admin')
  expect(first.records).toHaveLength(50)
  const second = listChatModerationRecords('admin', first.cursor!)
  expect(second.records).toHaveLength(2)
  expect(second.cursor).toBeNull()
  expect(
    new Set([...first.records, ...second.records].map((row) => row.id)).size,
  ).toBe(52)
  for (const actor of ['owner', 'participant', 'missing']) {
    expect(() => listChatModerationRecords(actor)).toThrow('Not authorized')
    expect(() => clearChatModerationRecords(actor)).toThrow('Not authorized')
  }
})

it('updates current Owner badges when restrictions are rejected without rewriting history', async () => {
  const { sendChatMessage, loadLatestChatHistory } = await import('@/lib/chat')
  const { applyChatBan, applyChatTimeout, getChatParticipantState } =
    await import('@/lib/chat-moderation')
  const room = { ...channel, id: crypto.randomUUID() }
  const now = new Date()
  const message = sendChatMessage({
    channel: room,
    participant: { accountId: 'owner', profileName: 'Owner' },
    rawContent: 'Old owner message',
    now: new Date(now.getTime() - 601_000),
  })
  expect(message.badges).toEqual(['owner'])
  expect(() =>
    applyChatBan({
      channel: room,
      actorId: 'admin',
      messageId: message.id,
      category: 'Spam',
      now,
    }),
  ).toThrow('Not authorized')
  expect(loadLatestChatHistory(room, now).messages[0].badges).toEqual(['owner'])
  expect(getChatParticipantState(room, 'participant', now).authorities).toEqual(
    [{ authorTag: message.authorTag, badges: ['owner'] }],
  )
  expect(() =>
    applyChatTimeout({
      channel: room,
      actorId: 'admin',
      messageId: message.id,
      category: 'Spam',
      durationMinutes: 10,
      now,
    }),
  ).toThrow('Not authorized')
  expect(loadLatestChatHistory(room, now).messages[0].badges).toEqual(['owner'])
  expect(getChatParticipantState(room, 'participant', now).authorities).toEqual(
    [{ authorTag: message.authorTag, badges: ['owner'] }],
  )
})

it('enforces bans and reversal through HTTP while preserving private state, reading, and reconnect access', async () => {
  const { getChatDatabase } = await import('@/lib/chat-database')
  const { sendChatMessage } = await import('@/lib/chat')
  const { POST: ban } =
    await import('@/app/api/channels/[slug]/chat/messages/[messageId]/ban/route')
  const { GET: restrictions, POST: reverse } =
    await import('@/app/api/channels/[slug]/chat/restrictions/route')
  const { GET: state } =
    await import('@/app/api/channels/[slug]/chat/state/route')
  const { GET: history, POST: send } =
    await import('@/app/api/channels/[slug]/chat/messages/route')
  const { GET: token } =
    await import('@/app/api/channels/[slug]/chat/token/route')
  const { GET: records, DELETE: clear } =
    await import('@/app/api/admin/chat/moderation/route')
  getChatDatabase().prepare('DELETE FROM chat_restriction').run()
  const message = sendChatMessage({
    channel: { ...channel, id: 'http-channel' },
    participant: { accountId: 'participant', profileName: 'Friend' },
    rawContent: 'Evidence',
    now: new Date(Date.now() + 3000),
  })
  const context = {
    params: Promise.resolve({ slug: 'moderation', messageId: message.id }),
  }
  const request = () => new Request('http://localhost/')
  const body = (value: unknown, method = 'POST') =>
    new Request('http://localhost/', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    })
  // Use a past timestamp so the message is retained at the HTTP server's clock.
  getChatDatabase()
    .prepare('UPDATE chat_message SET created_at = ? WHERE id = ?')
    .run(Date.now() - 1000, message.id)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({}, { status: 503 })),
  )
  try {
    session.accountId = 'participant'
    expect((await ban(body({ category: 'Spam' }), context)).status).toBe(403)
    session.accountId = 'admin'
    expect(
      (
        await ban(
          body({ category: 'Other', note: 'Private evidence' }),
          context,
        )
      ).status,
    ).toBe(200)
    const active = await (await restrictions(request(), context)).json()
    const restrictionId = active.restrictions[0].id
    session.accountId = 'owner'
    expect((await reverse(body({ restrictionId }), context)).status).toBe(403)
    expect((await records(request())).status).toBe(403)
    expect((await clear(body({ confirmed: true }, 'DELETE'))).status).toBe(403)
    session.accountId = 'participant'
    expect((await restrictions(request(), context)).status).toBe(403)
    const current = await (await state(request(), context)).json()
    expect(current.restriction).toEqual({ category: 'Other', expiresAt: null })
    expect(JSON.stringify(current)).not.toMatch(
      /Private|actor|note|participant/,
    )
    expect(
      (
        await send(
          body({
            content: 'Bypass',
            clientIdempotencyKey: crypto.randomUUID(),
          }),
          context,
        )
      ).status,
    ).toBe(403)
    expect((await history(request(), context)).status).toBe(200)
    expect((await token(request(), context)).status).toBe(200)
    session.accountId = 'admin'
    expect((await reverse(body({ restrictionId }), context)).status).toBe(200)
    expect((await records(request())).headers.get('cache-control')).toContain(
      'no-store',
    )
    expect((await clear(body({}, 'DELETE'))).status).toBe(400)
    expect((await clear(body({ confirmed: true }, 'DELETE'))).status).toBe(200)
    session.accountId = null
    expect((await restrictions(request(), context)).status).toBe(401)
    expect((await records(request())).status).toBe(401)
  } finally {
    session.accountId = 'owner'
    vi.unstubAllGlobals()
  }
})

it('commits ban and reversal events privately and rolls back a failed reversal', async () => {
  const { sendChatMessage } = await import('@/lib/chat')
  const { getChatDatabase } = await import('@/lib/chat-database')
  const {
    applyChatBan,
    listActiveChatRestrictions,
    reverseChatRestriction,
    getChatParticipantState,
    listChatModerationRecords,
  } = await import('@/lib/chat-moderation')
  const { dispatchNextChatOutboxEvent } = await import('@/lib/chat-outbox')
  const room = { ...channel, id: crypto.randomUUID() }
  const message = sendChatMessage({
    channel: room,
    participant: { accountId: 'participant', profileName: 'Secret profile' },
    rawContent: 'Secret content',
  })
  applyChatBan({
    channel: room,
    actorId: 'owner',
    messageId: message.id,
    category: 'Other',
    note: 'Secret note',
  })
  const [restriction] = listActiveChatRestrictions(room, 'owner')
  const db = getChatDatabase()
  db.exec(
    "CREATE TRIGGER reject_reversal BEFORE INSERT ON chat_outbox WHEN NEW.message_id IS NULL BEGIN SELECT RAISE(ABORT, 'control failed'); END",
  )
  try {
    expect(() => reverseChatRestriction(room, 'owner', restriction.id)).toThrow(
      'control failed',
    )
  } finally {
    db.exec('DROP TRIGGER reject_reversal')
  }
  expect(
    getChatParticipantState(room, 'participant').restriction,
  ).not.toBeNull()
  expect(
    listChatModerationRecords('admin').records.filter(
      (record) => record.sourceRecordId === restriction.id,
    ),
  ).toEqual([])
  reverseChatRestriction(room, 'owner', restriction.id)
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ result: {} }))
  while (
    await dispatchNextChatOutboxEvent(fetcher, new Date(Date.now() + 60_000))
  ) {
    /* drain */
  }
  const publications = fetcher.mock.calls
    .filter(([url]) => String(url).endsWith('/publish'))
    .map(([, options]) => JSON.parse(String(options?.body)))
  const roomEvents = publications.filter(
    (event) => event.channel === `chat:${room.id}`,
  )
  expect(roomEvents).toHaveLength(1)
  expect(roomEvents[0].data.message).toMatchObject({
    id: message.id,
    removed: true,
  })
  expect(JSON.stringify(roomEvents)).not.toMatch(
    /Secret|ban|restriction|Other|owner|participant/,
  )
  const controls = publications.filter(
    (event) =>
      event.channel === 'control:#participant' &&
      event.data.channelId === room.id,
  )
  expect(controls.map((event) => event.data)).toEqual([
    { type: 'restriction', channelId: room.id },
    { type: 'restriction', channelId: room.id },
  ])
})

it.each(['timeout', 'ban'] as const)(
  'rejects an owner %s through HTTP without changing messages, history, or delivery',
  async (action) => {
    const { sendChatMessage, loadLatestChatHistory } = await import(
      '@/lib/chat'
    )
    const {
      getChatMessageActions,
      getChatParticipantState,
      listChatModerationRecords,
    } = await import('@/lib/chat-moderation')
    const { dispatchNextChatOutboxEvent } = await import('@/lib/chat-outbox')
    const { POST: timeout } = await import(
      '@/app/api/channels/[slug]/chat/messages/[messageId]/timeout/route'
    )
    const { POST: ban } = await import(
      '@/app/api/channels/[slug]/chat/messages/[messageId]/ban/route'
    )
    const room = { ...channel, id: 'http-channel' }
    const message = sendChatMessage({
      channel: room,
      participant: { accountId: 'owner', profileName: 'Owner' },
      rawContent: 'Owner message',
      now: new Date(Date.now() - (action === 'timeout' ? 10_000 : 5_000)),
    })
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ result: {} }),
    )
    while (await dispatchNextChatOutboxEvent(fetcher)) {
      /* drain messages */
    }
    fetcher.mockClear()
    const history = loadLatestChatHistory(room)
    const records = listChatModerationRecords('admin')
    session.accountId = 'admin'
    try {
      const response = await (action === 'timeout' ? timeout : ban)(
        new Request('http://localhost/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: 'Spam', durationMinutes: 10 }),
        }),
        {
          params: Promise.resolve({
            slug: 'moderation',
            messageId: message.id,
          }),
        },
      )
      expect(response.status).toBe(403)
      expect(getChatMessageActions(room, 'admin', message.id)).toMatchObject({
        canRemove: true,
        canTimeout: false,
      })
      expect(getChatMessageActions(room, 'owner', message.id).canTimeout).toBe(
        false,
      )
      expect(getChatParticipantState(room, 'owner')).toMatchObject({
        restriction: null,
        moderatorRole: 'owner',
      })
      expect(loadLatestChatHistory(room)).toEqual(history)
      expect(listChatModerationRecords('admin')).toEqual(records)
      expect(await dispatchNextChatOutboxEvent(fetcher)).toBe(false)
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      session.accountId = 'owner'
    }
  },
)
