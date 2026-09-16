import 'server-only'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getDatabase } from '@/lib/auth/database'
import { getChatDatabase } from '@/lib/chat-database'
import {
  createChatTombstone,
  currentChatBadges,
  type ChatChannelReference,
} from '@/lib/chat'
import type {
  ChatParticipantState,
  ChatModeratorRole,
  ChatTombstone,
  PublicChatMessageEvent,
} from '@/lib/chat-types'
import { chatControlChannel, chatTranscriptChannel } from '@/lib/chat-realtime'
import {
  getActiveChatRestriction,
  getChatRestriction,
} from '@/lib/chat-restrictions'

export class ChatModerationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export const chatRemovalSchema = z
  .object({
    category: z.enum(['Spam', 'Harassment', 'Other']),
    note: z.string().trim().max(2000).default(''),
  })
  .refine(({ category, note }) => category !== 'Other' || note.length > 0, {
    message: 'Other requires a private note.',
  })

export const chatTimeoutSchema = chatRemovalSchema.safeExtend({
  durationMinutes: z.union([z.literal(10), z.literal(60), z.literal(1440)]),
})

function activeRole(accountId: string): string | null {
  const account = getDatabase()
    .prepare(
      "SELECT role FROM user WHERE id = ? AND activationStatus = 'active'",
    )
    .get(accountId) as { role: string | null } | undefined
  return account ? (account.role ?? 'user') : null
}

export function getChatModeratorRole(
  channel: ChatChannelReference,
  accountId: string,
  now = new Date(),
): ChatModeratorRole {
  const role = activeRole(accountId)
  if (role === 'admin') return 'admin'
  if (!role || channel.ownerUserId !== accountId) return null
  if (
    getActiveChatRestriction(channel.id, accountId, now)?.actorRole === 'admin'
  )
    return null
  return 'owner'
}

interface ModerationMessage {
  id: string
  roomId: string
  accountId: string
  sequence: number
  removedSequence: number | null
  createdAt: number
  content: string
  profileName: string
  authorTag: string
}

function requireModerator(
  channel: ChatChannelReference,
  actorId: string,
  now = new Date(),
): Exclude<ChatModeratorRole, null> {
  const role = getChatModeratorRole(channel, actorId, now)
  if (!role) throw new ChatModerationError('Not authorized.', 403)
  return role
}

function retainedMessage(
  channel: ChatChannelReference,
  messageId: string,
  now: Date,
): ModerationMessage {
  const row = getChatDatabase()
    .prepare(
      `
    SELECT message.id, room_id AS roomId, account_id AS accountId,
           room_sequence AS sequence, removed_sequence AS removedSequence,
           message.created_at AS createdAt, content,
           profile_name AS profileName, author_tag AS authorTag
    FROM chat_message message JOIN chat_room room ON room.id = message.room_id
    WHERE message.id = ? AND room.channel_id = ? AND message.created_at BETWEEN ? AND ?
  `,
    )
    .get(
      messageId,
      channel.id,
      now.getTime() - 7 * 24 * 60 * 60 * 1000,
      now.getTime(),
    ) as ModerationMessage | undefined
  if (!row) throw new ChatModerationError('Message not found.', 404)
  return row
}

function mayRemoveMessage(
  role: Exclude<ChatModeratorRole, null>,
  message: ModerationMessage,
): boolean {
  const target = getDatabase()
    .prepare('SELECT role FROM user WHERE id = ?')
    .get(message.accountId) as { role: string | null } | undefined
  return role === 'admin' || target?.role !== 'admin'
}

export function getChatMessageActions(
  channel: ChatChannelReference,
  actorId: string,
  messageId: string,
) {
  const role = requireModerator(channel, actorId)
  const message = retainedMessage(channel, messageId, new Date())
  return {
    canRemove: !message.removedSequence && mayRemoveMessage(role, message),
    canInspect: Boolean(message.removedSequence),
    canTimeout:
      mayRemoveMessage(role, message) &&
      (role === 'admin' ||
        getActiveChatRestriction(channel.id, message.accountId)?.actorRole !==
          'admin'),
  }
}

interface RemoveChatMessageInput {
  channel: ChatChannelReference
  actorId: string
  messageId: string
  category: string
  note?: string
  now?: Date
}

export function removeChatMessage({
  channel,
  actorId,
  messageId,
  category,
  note,
  now = new Date(),
}: RemoveChatMessageInput): ChatTombstone {
  const parsed = chatRemovalSchema.safeParse({ category, note })
  if (!parsed.success)
    throw new ChatModerationError(
      'Select a category. Other requires a private note of at most 2000 characters.',
      400,
    )
  const database = getChatDatabase()
  return database
    .transaction(() => {
      const role = requireModerator(channel, actorId, now)
      const message = retainedMessage(channel, messageId, now)
      if (!mayRemoveMessage(role, message)) {
        throw new ChatModerationError('Not authorized.', 403)
      }
      let revisionSequence = message.removedSequence
      if (!revisionSequence) {
        const room = database
          .prepare(
            'SELECT next_sequence AS sequence FROM chat_room WHERE id = ?',
          )
          .get(message.roomId) as { sequence: number }
        revisionSequence = room.sequence
        database
          .prepare(
            'UPDATE chat_room SET next_sequence = next_sequence + 1 WHERE id = ?',
          )
          .run(message.roomId)
        database
          .prepare(
            'UPDATE chat_message SET removed_sequence = ?, removed_at = ? WHERE id = ?',
          )
          .run(revisionSequence, now.getTime(), message.id)
        database
          .prepare(
            `INSERT INTO chat_moderation_record
        (id, action, category, actor_account_id, target_account_id, room_id, message_id, private_note, created_at, message_created_at)
        VALUES (?, 'message_removal', ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            parsed.data.category,
            actorId,
            message.accountId,
            message.roomId,
            message.id,
            parsed.data.note || null,
            now.getTime(),
            message.createdAt,
          )
        const tombstone = createChatTombstone(message, revisionSequence)
        const event: PublicChatMessageEvent = {
          type: 'message',
          eventId: randomUUID(),
          message: tombstone,
        }
        // Replace any unsent original event. An in-flight older event cannot overwrite
        // the newer revision in the client.
        database
          .prepare('DELETE FROM chat_outbox WHERE message_id = ?')
          .run(message.id)
        database
          .prepare(
            `INSERT INTO chat_outbox (id, message_id, channel_name, payload, next_attempt_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            event.eventId,
            message.id,
            chatTranscriptChannel(channel.id),
            JSON.stringify(event),
            now.getTime(),
            now.getTime(),
          )
      }
      return createChatTombstone(message, revisionSequence)
    })
    .immediate()
}

export function inspectRemovedChatMessage(
  channel: ChatChannelReference,
  actorId: string,
  messageId: string,
  now = new Date(),
) {
  requireModerator(channel, actorId, now)
  const message = retainedMessage(channel, messageId, now)
  if (!message.removedSequence)
    throw new ChatModerationError('Removed message not found.', 404)
  const record = getChatDatabase()
    .prepare(
      `SELECT category, private_note AS note, created_at AS createdAt
    FROM chat_moderation_record WHERE message_id = ?`,
    )
    .get(message.id) as {
    category: string
    note: string | null
    createdAt: number
  }
  return {
    content: message.content,
    profileName: message.profileName,
    authorTag: message.authorTag,
    ...record,
  }
}

function currentChatAuthorities(channel: ChatChannelReference, now: Date) {
  const accounts = getDatabase()
    .prepare(
      "SELECT id FROM user WHERE activationStatus = 'active' AND (role = 'admin' OR id = ?)",
    )
    .all(channel.ownerUserId) as Array<{ id: string }>
  return accounts.flatMap((account) => {
    const participant = getChatDatabase()
      .prepare(
        `SELECT author_tag AS authorTag FROM chat_participant p JOIN chat_room r ON r.id = p.room_id WHERE r.channel_id = ? AND p.account_id = ?`,
      )
      .get(channel.id, account.id) as { authorTag: string } | undefined
    const badges = currentChatBadges(account.id, channel, now)
    return participant && badges.length
      ? [{ authorTag: participant.authorTag, badges }]
      : []
  })
}

export function getChatParticipantState(
  channel: ChatChannelReference,
  accountId: string,
  now = new Date(),
): ChatParticipantState {
  return getChatDatabase().transaction(() => ({
    channelId: channel.id,
    restriction: getChatRestriction(channel.id, accountId, now),
    moderatorRole: getChatModeratorRole(channel, accountId, now),
    serverTime: now.toISOString(),
    authorities: currentChatAuthorities(channel, now),
  }))()
}

export function applyChatTimeout(
  input: RemoveChatMessageInput & { durationMinutes: number },
) {
  const parsed = chatTimeoutSchema.safeParse(input)
  if (!parsed.success)
    throw new ChatModerationError(
      'Select a timeout and category. Other requires a private note of at most 2000 characters.',
      400,
    )
  return applyChatRestriction({ ...input, ...parsed.data })
}

export function applyChatBan(input: RemoveChatMessageInput) {
  const parsed = chatRemovalSchema.safeParse(input)
  if (!parsed.success)
    throw new ChatModerationError(
      'Select a category. Other requires a private note of at most 2000 characters.',
      400,
    )
  return applyChatRestriction({
    ...input,
    ...parsed.data,
    durationMinutes: null,
  })
}

function applyChatRestriction({
  channel,
  actorId,
  messageId,
  category,
  note,
  durationMinutes,
  now = new Date(),
}: RemoveChatMessageInput & { durationMinutes: number | null }) {
  const database = getChatDatabase()
  return database
    .transaction(() => {
      const role = requireModerator(channel, actorId, now)
      const target = retainedMessage(channel, messageId, now)
      if (
        !mayRemoveMessage(role, target) ||
        (role === 'owner' &&
          getActiveChatRestriction(channel.id, target.accountId, now)
            ?.actorRole === 'admin')
      ) {
        throw new ChatModerationError('Not authorized.', 403)
      }
      if (
        durationMinutes !== null &&
        getActiveChatRestriction(channel.id, target.accountId, now)
          ?.expiresAt === null
      ) {
        throw new ChatModerationError(
          'Lift the Chat ban before applying a timeout.',
          409,
        )
      }
      const recordId = randomUUID()
      const expiresAt =
        durationMinutes === null
          ? null
          : now.getTime() + durationMinutes * 60_000
      database
        .prepare(
          `INSERT INTO chat_moderation_record
      (id, action, category, actor_account_id, target_account_id, room_id, private_note, created_at, expires_at, actor_role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          recordId,
          durationMinutes === null ? 'ban' : 'timeout',
          category,
          actorId,
          target.accountId,
          target.roomId,
          note || null,
          now.getTime(),
          expiresAt,
          role,
        )

      const affected = database
        .prepare(
          `SELECT id FROM chat_message
      WHERE room_id = ? AND account_id = ? AND created_at BETWEEN ? AND ? AND removed_sequence IS NULL
      ORDER BY room_sequence`,
        )
        .all(
          target.roomId,
          target.accountId,
          now.getTime() - 600_000,
          now.getTime(),
        ) as Array<{ id: string }>
      const messages = affected.map(({ id }) =>
        removeChatMessage({
          channel,
          actorId,
          messageId: id,
          category,
          note,
          now,
        }),
      )
      database
        .prepare(
          `INSERT INTO chat_restriction (room_id, account_id, record_id, category, actor_role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (room_id, account_id) DO UPDATE SET record_id = excluded.record_id, category = excluded.category, actor_role = excluded.actor_role, created_at = excluded.created_at, expires_at = excluded.expires_at`,
        )
        .run(
          target.roomId,
          target.accountId,
          recordId,
          category,
          role,
          now.getTime(),
          expiresAt,
        )
      // The event asks this participant's clients to load the current private state.
      // It does not announce the restriction to the room.
      database
        .prepare(
          `INSERT INTO chat_outbox (id, channel_name, payload, next_attempt_at, created_at)
      VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          chatControlChannel(target.accountId),
          JSON.stringify({ type: 'restriction', channelId: channel.id }),
          now.getTime(),
          now.getTime(),
        )
      return { messages }
    })
    .immediate()
}

interface ActiveRestrictionRow {
  id: string
  accountId: string
  category: 'Spam' | 'Harassment' | 'Other'
  actorRole: 'admin' | 'owner'
  createdAt: number
  expiresAt: number | null
  authorTag: string
}

function activeRestrictions(channel: ChatChannelReference, now: Date) {
  return getChatDatabase()
    .prepare(
      `
    SELECT restriction.record_id AS id, restriction.account_id AS accountId,
      restriction.category, restriction.actor_role AS actorRole,
      restriction.created_at AS createdAt, restriction.expires_at AS expiresAt,
      participant.author_tag AS authorTag
    FROM chat_restriction restriction
    JOIN chat_room room ON room.id = restriction.room_id
    JOIN chat_participant participant ON participant.room_id = room.id AND participant.account_id = restriction.account_id
    WHERE room.channel_id = ? AND (restriction.expires_at IS NULL OR restriction.expires_at > ?)
    ORDER BY restriction.created_at DESC, restriction.record_id DESC
  `,
    )
    .all(channel.id, now.getTime()) as ActiveRestrictionRow[]
}

function accountName(accountId: string): string {
  return (
    (
      getDatabase()
        .prepare('SELECT name FROM user WHERE id = ?')
        .get(accountId) as { name: string } | undefined
    )?.name ?? 'Deleted account'
  )
}

export function listActiveChatRestrictions(
  channel: ChatChannelReference,
  actorId: string,
  now = new Date(),
) {
  const role = requireModerator(channel, actorId, now)
  return activeRestrictions(channel, now).map((row) => ({
    id: row.id,
    target: accountName(row.accountId),
    authorTag: row.authorTag,
    action: row.expiresAt === null ? ('ban' as const) : ('timeout' as const),
    category: row.category,
    createdAt: new Date(row.createdAt).toISOString(),
    expiresAt:
      row.expiresAt === null ? null : new Date(row.expiresAt).toISOString(),
    canReverse: role === 'admin' || row.actorRole === 'owner',
  }))
}

export function reverseChatRestriction(
  channel: ChatChannelReference,
  actorId: string,
  restrictionId: string,
  now = new Date(),
) {
  const database = getChatDatabase()
  return database
    .transaction(() => {
      const role = requireModerator(channel, actorId, now)
      const restriction = activeRestrictions(channel, now).find(
        (row) => row.id === restrictionId,
      )
      if (!restriction)
        throw new ChatModerationError('Active Chat restriction not found.', 404)
      if (role !== 'admin' && restriction.actorRole !== 'owner')
        throw new ChatModerationError('Not authorized.', 403)
      const { id: roomId } = database
        .prepare('SELECT id FROM chat_room WHERE channel_id = ?')
        .get(channel.id) as { id: string }
      database
        .prepare(
          `INSERT INTO chat_moderation_record
      (id, action, category, actor_account_id, target_account_id, room_id, created_at, actor_role, source_record_id)
      VALUES (?, 'reversal', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          restriction.category,
          actorId,
          restriction.accountId,
          roomId,
          now.getTime(),
          role,
          restriction.id,
        )
      database
        .prepare(
          'UPDATE chat_moderation_record SET reversed_at = ? WHERE id = ?',
        )
        .run(now.getTime(), restriction.id)
      database
        .prepare(
          'DELETE FROM chat_restriction WHERE room_id = ? AND account_id = ? AND record_id = ?',
        )
        .run(roomId, restriction.accountId, restriction.id)
      database
        .prepare(
          `INSERT INTO chat_outbox (id, channel_name, payload, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          chatControlChannel(restriction.accountId),
          JSON.stringify({ type: 'restriction', channelId: channel.id }),
          now.getTime(),
          now.getTime(),
        )
    })
    .immediate()
}

function requireChatAdministrator(actorId: string) {
  if (activeRole(actorId) !== 'admin')
    throw new ChatModerationError('Not authorized.', 403)
}

interface ModerationRecordRow {
  id: string
  action: 'message_removal' | 'timeout' | 'ban' | 'reversal'
  category: string
  actorId: string
  targetId: string
  channelId: string | null
  createdAt: number
  expiresAt: number | null
  reversedAt: number | null
  sourceRecordId: string | null
  active: number
}

export function listChatModerationRecords(
  actorId: string,
  cursor?: string,
  now = new Date(),
) {
  requireChatAdministrator(actorId)
  let before: { createdAt: number; id: string } | undefined
  if (cursor) {
    const match = /^(\d+):([a-zA-Z0-9-]+)$/.exec(cursor)
    if (!match || !Number.isSafeInteger(Number(match[1])))
      throw new ChatModerationError('Invalid history cursor.', 400)
    before = { createdAt: Number(match[1]), id: match[2] }
  }
  const rows = getChatDatabase()
    .prepare(
      `
    SELECT record.id, record.action, record.category, record.actor_account_id AS actorId,
      record.target_account_id AS targetId, room.channel_id AS channelId,
      record.created_at AS createdAt, record.expires_at AS expiresAt, record.reversed_at AS reversedAt,
      record.source_record_id AS sourceRecordId,
      EXISTS(SELECT 1 FROM chat_restriction r WHERE r.record_id = record.id AND (r.expires_at IS NULL OR r.expires_at > ?)) AS active
    FROM chat_moderation_record record LEFT JOIN chat_room room ON room.id = record.room_id
    ${before ? 'WHERE (record.created_at, record.id) < (?, ?)' : ''}
    ORDER BY record.created_at DESC, record.id DESC LIMIT 51
  `,
    )
    .all(
      now.getTime(),
      ...(before ? [before.createdAt, before.id] : []),
    ) as ModerationRecordRow[]
  const page = rows.slice(0, 50)
  return {
    records: page.map((row) => {
      const room = getDatabase()
        .prepare('SELECT display_name AS name, slug FROM channel WHERE id = ?')
        .get(row.channelId) as { name: string; slug: string } | undefined
      return {
        id: row.id,
        action: row.action,
        category: row.category,
        actor: accountName(row.actorId),
        target: accountName(row.targetId),
        room: room?.name ?? 'Deleted Channel',
        channelSlug: room?.slug ?? null,
        state:
          row.action === 'message_removal' || row.action === 'reversal'
            ? 'completed'
            : row.reversedAt !== null
              ? 'reversed'
              : row.active
                ? 'active'
                : row.expiresAt !== null && row.expiresAt <= now.getTime()
                  ? 'expired'
                  : 'superseded',
        createdAt: new Date(row.createdAt).toISOString(),
        expiresAt:
          row.expiresAt === null ? null : new Date(row.expiresAt).toISOString(),
        reversedAt:
          row.reversedAt === null
            ? null
            : new Date(row.reversedAt).toISOString(),
        sourceRecordId: row.sourceRecordId,
      }
    }),
    cursor:
      rows.length > 50 ? `${page.at(-1)!.createdAt}:${page.at(-1)!.id}` : null,
  }
}

export function clearChatModerationRecords(actorId: string) {
  requireChatAdministrator(actorId)
  getChatDatabase().prepare('DELETE FROM chat_moderation_record').run()
}
