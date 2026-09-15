import 'server-only'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getDatabase } from '@/lib/auth/database'
import { getChatDatabase } from '@/lib/chat-database'
import { createChatTombstone, type ChatChannelReference } from '@/lib/chat'
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
  }))()
}

export function applyChatTimeout({
  channel,
  actorId,
  messageId,
  durationMinutes,
  category,
  note,
  now = new Date(),
}: RemoveChatMessageInput & { durationMinutes: number }) {
  const parsed = chatTimeoutSchema.safeParse({
    durationMinutes,
    category,
    note,
  })
  if (!parsed.success)
    throw new ChatModerationError(
      'Select a timeout and category. Other requires a private note of at most 2000 characters.',
      400,
    )
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
      const recordId = randomUUID()
      const expiresAt = now.getTime() + parsed.data.durationMinutes * 60_000
      database
        .prepare(
          `INSERT INTO chat_moderation_record
      (id, action, category, actor_account_id, target_account_id, room_id, private_note, created_at, expires_at, actor_role)
      VALUES (?, 'timeout', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          recordId,
          parsed.data.category,
          actorId,
          target.accountId,
          target.roomId,
          parsed.data.note || null,
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
          category: parsed.data.category,
          note: parsed.data.note,
          now,
        }),
      )
      database
        .prepare(
          `INSERT INTO chat_restriction (room_id, account_id, record_id) VALUES (?, ?, ?)
      ON CONFLICT (room_id, account_id) DO UPDATE SET record_id = excluded.record_id`,
        )
        .run(target.roomId, target.accountId, recordId)
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
