// @vitest-environment node
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const directory = mkdtempSync(join(tmpdir(), 'chat-owner-protection-'))
process.env.AUTH_DB_PATH = join(directory, 'auth.sqlite')
process.env.CHAT_DB_PATH = join(directory, 'chat.sqlite')
process.env.CHAT_TAG_HMAC_SECRET = 'owner-protection-test-secret-32-characters'
const room = { id: 'own-room', ownerUserId: 'owner' }
const otherRoom = { id: 'other-room', ownerUserId: 'admin' }

beforeAll(async () => {
  for (const script of ['scripts/migrate.mjs', 'scripts/migrate-chat.mjs']) {
    const result = spawnSync(process.execPath, [script], { env: process.env })
    expect(result.status, result.stderr.toString()).toBe(0)
  }
  const { getDatabase } = await import('@/lib/auth/database')
  for (const accountId of ['owner', 'admin']) {
    getDatabase()
      .prepare(
        `INSERT INTO user
      (id, name, email, emailVerified, createdAt, updatedAt, role, activationStatus)
      VALUES (?, ?, ?, 0, 0, 0, ?, 'active')`,
      )
      .run(
        accountId,
        accountId,
        `${accountId}@test.invalid`,
        accountId === 'admin' ? 'admin' : 'user',
      )
  }
  for (const channel of [room, otherRoom]) {
    getDatabase()
      .prepare(
        `INSERT INTO channel
      (id, owner_user_id, slug, media_path, display_name, title, enabled, created_at, updated_at, created_by)
      VALUES (?, ?, ?, ?, 'Room', 'Room', 1, 0, 0, 'admin')`,
      )
      .run(channel.id, channel.ownerUserId, channel.id, channel.id)
  }
})

afterAll(async () => {
  const { getDatabase } = await import('@/lib/auth/database')
  const { closeChatDatabase } = await import('@/lib/chat-database')
  closeChatDatabase()
  getDatabase().close()
  rmSync(directory, { recursive: true, force: true })
})

it.each(['timeout', 'ban', 'expired', 'cleared-history'])(
  'applies owner protection on storage open for a legacy %s and can repeat safely',
  async (kind) => {
    const { getChatDatabase, closeChatDatabase } = await import(
      '@/lib/chat-database'
    )
    const { sendChatMessage, loadLatestChatHistory } = await import(
      '@/lib/chat'
    )
    const {
      getChatParticipantState,
      listChatModerationRecords,
      removeChatMessage,
    } = await import('@/lib/chat-moderation')
    const { dispatchNextChatOutboxEvent } = await import('@/lib/chat-outbox')
    const db = getChatDatabase()
    db.exec(
      'DELETE FROM chat_restriction; DELETE FROM chat_moderation_record; DELETE FROM chat_room; DELETE FROM chat_outbox',
    )
    const now = new Date()
    const old = sendChatMessage({
      channel: room,
      participant: { accountId: 'owner', profileName: 'Owner' },
      rawContent: 'Keep this message',
      now: new Date(now.getTime() - 601_000),
    })
    const recent = sendChatMessage({
      channel: room,
      participant: { accountId: 'owner', profileName: 'Owner' },
      rawContent: 'Removed message',
      now: new Date(now.getTime() - 5_000),
    })
    removeChatMessage({
      channel: room,
      actorId: 'admin',
      messageId: recent.id,
      category: 'Spam',
      now,
    })
    sendChatMessage({
      channel: otherRoom,
      participant: { accountId: 'owner', profileName: 'Owner' },
      rawContent: 'Another room',
      now: new Date(now.getTime() - 5_000),
    })
    // Seed storage from the previous policy. New restrictions cannot create these rows.
    for (const channel of [room, otherRoom]) {
      const expiresAt =
        channel === otherRoom || kind === 'ban' || kind === 'cleared-history'
          ? null
          : now.getTime() + (kind === 'expired' ? -1_000 : 60_000)
      db.prepare(
        `INSERT INTO chat_moderation_record
        (id, action, category, actor_account_id, target_account_id, room_id, created_at, expires_at, actor_role)
        SELECT ?, ?, 'Spam', 'admin', 'owner', id, ?, ?, 'admin' FROM chat_room WHERE channel_id = ?`,
      ).run(
        `legacy-${channel.id}`,
        expiresAt === null ? 'ban' : 'timeout',
        now.getTime() - 5_000,
        expiresAt,
        channel.id,
      )
      db.prepare(
        `INSERT INTO chat_restriction
        (room_id, account_id, record_id, category, actor_role, created_at, expires_at)
        SELECT id, 'owner', ?, 'Spam', 'admin', ?, ? FROM chat_room WHERE channel_id = ?`,
      ).run(
        `legacy-${channel.id}`,
        now.getTime() - 5_000,
        expiresAt,
        channel.id,
      )
    }
    if (kind === 'cleared-history')
      db.exec("DELETE FROM chat_moderation_record WHERE id = 'legacy-own-room'")
    db.exec('DELETE FROM chat_outbox')
    closeChatDatabase()

    expect(getChatParticipantState(room, 'owner', now)).toMatchObject({
      restriction: null,
      moderatorRole: 'owner',
      authorities: [{ authorTag: old.authorTag, badges: ['owner'] }],
    })
    expect(
      getChatParticipantState(otherRoom, 'owner', now).restriction,
    ).toEqual({ category: 'Spam', expiresAt: null })
    expect(loadLatestChatHistory(room, now).messages).toEqual([
      expect.objectContaining({
        id: old.id,
        content: 'Keep this message',
        badges: ['owner'],
      }),
      expect.objectContaining({ id: recent.id, removed: true }),
    ])
    expect(
      sendChatMessage({
        channel: room,
        participant: { accountId: 'owner', profileName: 'Owner' },
        rawContent: 'Allowed again',
        now,
      }).content,
    ).toBe('Allowed again')
    const records = listChatModerationRecords('admin').records
    const reversals = records.filter((record) => record.action === 'reversal')
    expect(reversals).toEqual(
      kind === 'expired'
        ? []
        : [
            expect.objectContaining({
              actor: 'System: Channel owner protection',
              state: 'completed',
              sourceRecordId: 'legacy-own-room',
            }),
          ],
    )
    if (kind !== 'cleared-history') {
      expect(
        records.find((record) => record.id === 'legacy-own-room')?.state,
      ).toBe(kind === 'expired' ? 'expired' : 'reversed')
    }
    closeChatDatabase()
    expect(listChatModerationRecords('admin').records).toEqual(records)
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ result: {} }),
    )
    while (await dispatchNextChatOutboxEvent(fetcher)) {
      /* drain */
    }
    const controls = fetcher.mock.calls
      .filter(([url]) => String(url).endsWith('/publish'))
      .map(([, options]) => JSON.parse(String(options?.body)))
      .filter((event) => event.data.type === 'restriction')
    expect(controls).toEqual(
      kind === 'expired'
        ? []
        : [
            expect.objectContaining({
              channel: 'control:#owner',
              data: { type: 'restriction', channelId: room.id },
            }),
          ],
    )
  },
)

it('keeps a legacy restriction intact when its reversal notification cannot commit, then retries', async () => {
  const { getChatDatabase, closeChatDatabase } = await import(
    '@/lib/chat-database'
  )
  const { getChatParticipantState, listChatModerationRecords } = await import(
    '@/lib/chat-moderation'
  )
  const db = getChatDatabase()
  db.exec(`INSERT INTO chat_restriction
    (room_id, account_id, record_id, category, actor_role, created_at, expires_at)
    SELECT id, 'owner', 'retry-ban', 'Spam', 'admin', 0, NULL FROM chat_room WHERE channel_id = 'own-room';
    CREATE TRIGGER reject_policy_notification BEFORE INSERT ON chat_outbox
    BEGIN SELECT RAISE(ABORT, 'notification failed'); END;`)
  closeChatDatabase()
  expect(() => getChatParticipantState(room, 'owner')).toThrow(
    'notification failed',
  )
  expect(() => getChatParticipantState(room, 'owner')).toThrow(
    'notification failed',
  )
  const repair = new Database(process.env.CHAT_DB_PATH!)
  repair.exec('DROP TRIGGER reject_policy_notification')
  repair.close()
  expect(getChatParticipantState(room, 'owner').restriction).toBeNull()
  expect(
    listChatModerationRecords('admin').records.filter(
      (record) => record.sourceRecordId === 'retry-ban',
    ),
  ).toHaveLength(1)
})
