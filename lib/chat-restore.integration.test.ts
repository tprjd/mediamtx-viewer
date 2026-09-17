// @vitest-environment node
import Database from 'better-sqlite3'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const directory = mkdtempSync(join(tmpdir(), 'chat-restore-'))
process.env.AUTH_DB_PATH = join(directory, 'auth.sqlite')
process.env.CHAT_DB_PATH = join(directory, 'chat.sqlite')
process.env.CHAT_ENABLED = 'true'
process.env.INTERNAL_AUTH_SECRET = 'restore-test-internal-secret-32-characters'
const candidate = `${process.env.CHAT_DB_PATH}.restore-candidate`
const now = Date.now()

beforeAll(async () => {
  for (const script of ['migrate.mjs', 'migrate-chat.mjs']) {
    const result = spawnSync(process.execPath, [`scripts/${script}`], {
      env: process.env,
      encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
  }
  const { getDatabase } = await import('@/lib/auth/database')
  const auth = getDatabase()
  auth
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, role, activationStatus)
    VALUES ('account', 'Name', 'restore@example.test', 0, ?, ?, 'admin', 'active')`,
    )
    .run(now, now)
  auth
    .prepare(
      `INSERT INTO channel (id, owner_user_id, slug, media_path, display_name, title, accent_color, preferred_playback, enabled, created_at, updated_at, created_by)
    VALUES ('channel', 'account', 'restore', 'restore', 'Restore', 'Restore', '#8b5cf6', 'hls', 1, ?, ?, 'account')`,
    )
    .run(now, now)
  const { sendChatMessage } = await import('@/lib/chat')
  sendChatMessage({
    channel: { id: 'channel', ownerUserId: 'account' },
    participant: { accountId: 'account', profileName: 'Name' },
    rawContent: 'retained',
    now: new Date(now),
  })
  const { getChatDatabase } = await import('@/lib/chat-database')
  await getChatDatabase().backup(candidate)
})

afterAll(async () => {
  const { getDatabase } = await import('@/lib/auth/database')
  const { closeChatDatabase } = await import('@/lib/chat-database')
  getDatabase().close()
  closeChatDatabase()
  vi.unstubAllGlobals()
  rmSync(directory, { recursive: true, force: true })
})

it('rejects an unauthorized restore without entering maintenance', async () => {
  const { POST } = await import('@/app/api/internal/chat/restore/route')
  expect(
    (
      await POST(
        new Request('http://localhost/api/internal/chat/restore', {
          method: 'POST',
        }),
      )
    ).status,
  ).toBe(401)
  expect(existsSync(`${process.env.CHAT_DB_PATH}.maintenance`)).toBe(false)
})

it('allows an older backup to restore messages that an administrator cleared', async () => {
  const { clearChatHistory } = await import('@/lib/chat-history')
  const { loadLatestChatHistory } = await import('@/lib/chat-history')
  const channel = { id: 'channel', ownerUserId: 'account' }
  clearChatHistory(channel, 'account')
  expect(loadLatestChatHistory(channel).messages).toEqual([])
  const backup = new Database(candidate, { readonly: true })
  expect(backup.prepare('SELECT content FROM chat_message').get()).toEqual({ content: 'retained' })
  backup.close()
  // The next test restores this same candidate through the real restore route.
})

it('rejects orphan account references, then restores Chat and purges expired content before reopening', async () => {
  const { POST } = await import('@/app/api/internal/chat/restore/route')
  const { getChatDatabase } = await import('@/lib/chat-database')
  const { getDatabase } = await import('@/lib/auth/database')
  const { loadLatestChatHistory, loadOlderChatMessages, loadChatMessagesAfter, getChatHistoryState } = await import('@/lib/chat-history')
  const channel = { id: 'channel', ownerUserId: 'account' }
  const previousGeneration = getChatHistoryState(channel.id).restoreGeneration
  const request = () =>
    new Request('http://localhost/api/internal/chat/restore', {
      method: 'POST',
      headers: { 'x-internal-auth': process.env.INTERNAL_AUTH_SECRET! },
    })
  const snapshot = new Database(candidate)
  snapshot.prepare("UPDATE chat_message SET account_id = 'missing'").run()
  snapshot.close()
  expect((await POST(request())).status).toBe(503)
  expect(() => getChatDatabase()).toThrow('unavailable')
  expect(getDatabase().prepare('SELECT id FROM user').get()).toEqual({
    id: 'account',
  })
  const fixed = new Database(candidate)
  fixed.prepare("UPDATE chat_message SET account_id = 'account'").run()
  fixed
    .prepare(
      `INSERT INTO chat_message (id, room_id, room_sequence, account_id, profile_name, author_tag, content, created_at)
    SELECT 'expired', room_id, 100, account_id, profile_name, author_tag, 'expired text', ? FROM chat_message LIMIT 1`,
    )
    .run(now - 8 * 86400000)
  fixed.exec(`INSERT INTO chat_moderation_record
    (id, action, category, actor_account_id, target_account_id, room_id, created_at, source_record_id)
    SELECT 'policy-reversal', 'reversal', 'Spam', 'system:channel-owner-protection', 'account', id, 0, 'previous-ban'
    FROM chat_room;
    INSERT INTO chat_restriction
    (room_id, account_id, record_id, category, actor_role, created_at, expires_at)
    SELECT id, 'account', 'legacy-owner-ban', 'Spam', 'admin', 0, NULL FROM chat_room;`)
  fixed.close()
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  let entered!: () => void
  const entering = new Promise<void>((resolve) => {
    entered = resolve
  })
  vi.stubGlobal('fetch', async () => {
    entered()
    await blocked
    return Response.json({ result: {} })
  })
  const restoration = POST(request())
  expect(
    await Promise.race([entering.then(() => null), restoration]),
  ).toBeNull()
  expect(() => getChatDatabase()).toThrow('unavailable')
  expect(getDatabase().prepare('SELECT slug FROM channel').get()).toEqual({
    slug: 'restore',
  })
  release()
  expect((await restoration).status).toBe(200)
  const { getChatParticipantState, listChatModerationRecords } = await import(
    '@/lib/chat-moderation'
  )
  expect(
    getChatParticipantState(
      { id: 'channel', ownerUserId: 'account' },
      'account',
    ).restriction,
  ).toBeNull()
  expect(listChatModerationRecords('account').records).toEqual([
    expect.objectContaining({
      actor: 'System: Channel owner protection',
      sourceRecordId: 'legacy-owner-ban',
    }),
    expect.objectContaining({
      actor: 'System: Channel owner protection',
      sourceRecordId: 'previous-ban',
    }),
  ])
  const restored = getChatHistoryState(channel.id)
  expect(restored.restoreGeneration).not.toBe(previousGeneration)
  expect(restored).toMatchObject({ clearedThrough: 0, clearPending: false })
  for (const page of [
    loadLatestChatHistory(channel),
    loadOlderChatMessages(channel, 'chat-history-v1:100'),
    loadChatMessagesAfter(channel, 0),
  ]) {
    expect(page).toMatchObject({
      ...restored,
      messages: [expect.objectContaining({ content: 'retained' })],
      hasMore: false,
    })
  }
  expect(
    getChatDatabase()
      .prepare("SELECT 1 FROM chat_message WHERE id = 'expired'")
      .get(),
  ).toBeUndefined()
  expect(existsSync(`${process.env.CHAT_DB_PATH}.maintenance`)).toBe(false)
})

it('cleans Chat at startup and each hour even when Chat is disabled', async () => {
  const { getChatDatabase } = await import('@/lib/chat-database')
  const { startChatRetention, waitForChatRetention } = await import(
    '@/lib/chat-retention'
  )
  const database = getChatDatabase()
  const seed = () =>
    database
      .prepare(
        `INSERT INTO chat_message
    (id, room_id, room_sequence, account_id, profile_name, author_tag, content, created_at)
    SELECT 'hourly-expired', room_id, 101, account_id, profile_name, author_tag, 'expired', 0 FROM chat_message LIMIT 1`,
      )
      .run()
  const expired = () =>
    database
      .prepare("SELECT 1 FROM chat_message WHERE id = 'hourly-expired'")
      .get()
  vi.useFakeTimers()
  process.env.CHAT_ENABLED = 'false'
  try {
    seed()
    await startChatRetention()
    expect(expired()).toBeUndefined()
    seed()
    vi.advanceTimersByTime(59 * 60 * 1000)
    expect(expired()).toBeTruthy()
    vi.advanceTimersByTime(60 * 1000)
    await waitForChatRetention()
    expect(expired()).toBeUndefined()
  } finally {
    vi.useRealTimers()
    process.env.CHAT_ENABLED = 'true'
  }
})

it.each(['missing', 'corrupt'])(
  'restores a valid backup when live Chat storage is %s',
  async (failure) => {
    const { writeFileSync } = await import('node:fs')
    const { getChatDatabase, closeChatDatabase } = await import(
      '@/lib/chat-database'
    )
    const { restoreChat } = await import('@/lib/chat-restore')
    await getChatDatabase().backup(candidate)
    closeChatDatabase()
    for (const suffix of ['', '-wal', '-shm'])
      rmSync(`${process.env.CHAT_DB_PATH}${suffix}`, { force: true })
    if (failure === 'corrupt')
      writeFileSync(process.env.CHAT_DB_PATH!, 'corrupt database')
    await restoreChat()
    expect(
      getChatDatabase().prepare('SELECT content FROM chat_message').get(),
    ).toEqual({ content: 'retained' })
  },
)
