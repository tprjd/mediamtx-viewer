import 'server-only'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getDatabase } from '@/lib/auth/database'
import { getChatDatabase } from '@/lib/chat-database'
import { createChatTombstone, type ChatChannelReference } from '@/lib/chat'
import type {
  ChatModeratorRole,
  ChatTombstone,
  PublicChatMessageEvent,
} from '@/lib/chat-types'
import { chatTranscriptChannel } from '@/lib/chat-realtime'

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
): ChatModeratorRole {
  const role = activeRole(accountId)
  if (role === 'admin') return 'admin'
  return role && channel.ownerUserId === accountId ? 'owner' : null
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
): Exclude<ChatModeratorRole, null> {
  const role = getChatModeratorRole(channel, actorId)
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
      const role = requireModerator(channel, actorId)
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
  requireModerator(channel, actorId)
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
