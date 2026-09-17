import 'server-only'

import { createHash, createHmac, randomUUID } from 'node:crypto'

import { getDatabase } from '@/lib/auth/database'
import { assertChatMessageStorage } from '@/lib/chat-storage'
import { getChatDatabase } from '@/lib/chat-database'
import { chatEnvironment } from '@/lib/chat-environment'
import {
  ChatRestrictionError,
  getChatRestriction,
  getActiveChatRestriction,
} from '@/lib/chat-restrictions'
import {
  allocateChatAuthorTag,
  normalizeChatMessage,
  decideChatSendRate,
  ChatRateLimitError,
  ChatMessageValidationError,
  ChatMessageClearedError,
} from '@/lib/chat-rules'
import type {
  ChatTombstone,
  PublicChatMessage,
  PublicChatMessageEvent,
} from '@/lib/chat-types'
import {
  chatTranscriptChannel,
  createChatPublicationId,
} from '@/lib/chat-realtime'

export type { PublicChatMessage } from '@/lib/chat-types'

export interface ChatChannelReference {
  id: string
  ownerUserId: string
}

export interface ChatParticipantReference {
  accountId: string
  profileName: string
}

export interface ChatMessageRow {
  removedSequence?: number | null
  clientIdempotencyKey?: string | null
  id: string
  sequence: number
  accountId: string
  profileName: string
  authorTag: string
  content: string
  createdAt: number
}

interface SendChatMessageInput {
  channel: ChatChannelReference
  participant: ChatParticipantReference
  rawContent: string
  now?: Date
  clientIdempotencyKey?: string
  messageId?: string
}

function createAuthorTagDigest(roomId: string, accountId: string): string {
  return createHmac('sha256', chatEnvironment.tagHmacSecret)
    .update(roomId)
    .update('\0')
    .update(accountId)
    .digest('hex')
}

export function currentChatBadges(
  accountId: string,
  channel: ChatChannelReference,
  now = new Date(),
): Array<'admin' | 'owner'> {
  const account = getDatabase()
    .prepare('SELECT role, activationStatus FROM user WHERE id = ?')
    .get(accountId) as
    { role: string | null; activationStatus: string } | undefined
  if (!account || account.activationStatus !== 'active') return []

  const badges: Array<'admin' | 'owner'> = []
  if (account.role === 'admin') badges.push('admin')
  if (
    accountId === channel.ownerUserId &&
    (account.role === 'admin' ||
      getActiveChatRestriction(channel.id, accountId, now)?.actorRole !==
        'admin')
  )
    badges.push('owner')
  return badges
}

export function createChatTombstone(
  message: { id: string; sequence: number; createdAt: number },
  revisionSequence: number,
): ChatTombstone {
  return {
    id: message.id,
    sequence: message.sequence,
    revisionSequence,
    serverTimestamp: new Date(message.createdAt).toISOString(),
    removed: true,
  }
}

export function toPublicMessage(
  row: ChatMessageRow,
  channel: ChatChannelReference,
  now: Date,
): PublicChatMessage {
  if (row.removedSequence) {
    return createChatTombstone(row, row.removedSequence)
  }
  return {
    id: row.id,
    ...(row.clientIdempotencyKey
      ? {
          submissionId: createHash('sha256')
            .update(row.clientIdempotencyKey)
            .digest('hex'),
        }
      : {}),
    sequence: row.sequence,
    content: row.content,
    profileName: row.profileName,
    authorTag: row.authorTag,
    badges: currentChatBadges(row.accountId, channel, now),
    serverTimestamp: new Date(row.createdAt).toISOString(),
  }
}

export function sendChatMessage({
  channel,
  participant,
  rawContent,
  now = new Date(),
  messageId = randomUUID(),
  clientIdempotencyKey = randomUUID(),
}: SendChatMessageInput): PublicChatMessage {
  const content = normalizeChatMessage(rawContent)
  const database = getChatDatabase()

  return database
    .transaction(() => {
      // Serialize this check with moderation writes, including idempotent retries.
      const restriction = getChatRestriction(
        channel.id,
        participant.accountId,
        now,
      )
      if (restriction) throw new ChatRestrictionError(restriction)
      database
        .prepare(
          `INSERT OR IGNORE INTO chat_room (id, channel_id, next_sequence, created_at)
         VALUES (?, ?, 1, ?)`,
        )
        .run(randomUUID(), channel.id, now.getTime())
      const room = database
        .prepare(
          'SELECT id, next_sequence AS nextSequence FROM chat_room WHERE channel_id = ?',
        )
        .get(channel.id) as { id: string; nextSequence: number }

      if (database.prepare(`
        SELECT 1 FROM chat_cleared_submission
        WHERE room_id = ? AND account_id = ? AND client_idempotency_key = ?
      `).get(room.id, participant.accountId, clientIdempotencyKey)) {
        throw new ChatMessageClearedError('This message was cleared by an administrator.')
      }

      const existing = database
        .prepare(
          `
      SELECT id, room_sequence AS sequence, account_id AS accountId,
             profile_name AS profileName, author_tag AS authorTag, content,
             created_at AS createdAt, client_idempotency_key AS clientIdempotencyKey,
             removed_sequence AS removedSequence
      FROM chat_message
      WHERE room_id = ? AND account_id = ? AND client_idempotency_key = ?
    `,
        )
        .get(room.id, participant.accountId, clientIdempotencyKey) as
        ChatMessageRow | undefined
      if (existing) {
        if (existing.content !== content) {
          throw new ChatMessageValidationError(
            'Retry must use the original message.',
          )
        }
        return toPublicMessage(existing, channel, now)
      }

      assertChatMessageStorage(database)

      const rateState = database
        .prepare(
          `
      SELECT next_send_time AS nextSendTime FROM chat_participant
      WHERE room_id = ? AND account_id = ?
    `,
        )
        .get(room.id, participant.accountId) as
        { nextSendTime: number } | undefined
      const recent = database
        .prepare(
          `
      SELECT created_at AS createdAt FROM chat_message
      WHERE room_id = ? AND account_id = ? ORDER BY created_at DESC LIMIT 5
    `,
        )
        .all(room.id, participant.accountId) as Array<{ createdAt: number }>
      const rate = decideChatSendRate(
        now.getTime(),
        rateState?.nextSendTime ?? 0,
        recent.map(({ createdAt }) => createdAt),
      )
      if (!rate.allowed) throw new ChatRateLimitError(rate.retryAt)

      let participantRow = database
        .prepare(
          `SELECT author_tag AS authorTag FROM chat_participant
         WHERE room_id = ? AND account_id = ?`,
        )
        .get(room.id, participant.accountId) as
        { authorTag: string } | undefined
      if (!participantRow) {
        const existingTags = new Set(
          (
            database
              .prepare(
                'SELECT author_tag AS authorTag FROM chat_participant WHERE room_id = ?',
              )
              .all(room.id) as Array<{ authorTag: string }>
          ).map(({ authorTag }) => authorTag),
        )
        participantRow = {
          authorTag: allocateChatAuthorTag(
            createAuthorTagDigest(room.id, participant.accountId),
            existingTags,
          ),
        }
        database
          .prepare(
            `INSERT INTO chat_participant
            (room_id, account_id, author_tag, created_at)
           VALUES (?, ?, ?, ?)`,
          )
          .run(
            room.id,
            participant.accountId,
            participantRow.authorTag,
            now.getTime(),
          )
      }

      database
        .prepare(
          'UPDATE chat_participant SET next_send_time = ? WHERE room_id = ? AND account_id = ?',
        )
        .run(rate.nextSendTime, room.id, participant.accountId)

      database
        .prepare('UPDATE chat_room SET next_sequence = ? WHERE id = ?')
        .run(room.nextSequence + 1, room.id)
      database
        .prepare(
          `INSERT INTO chat_message (
          id, room_id, room_sequence, account_id, profile_name,
          author_tag, content, created_at, client_idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          messageId,
          room.id,
          room.nextSequence,
          participant.accountId,
          participant.profileName,
          participantRow.authorTag,
          content,
          now.getTime(),
          clientIdempotencyKey,
        )

      const row = {
        clientIdempotencyKey,
        id: messageId,
        sequence: room.nextSequence,
        accountId: participant.accountId,
        profileName: participant.profileName,
        authorTag: participantRow.authorTag,
        content,
        createdAt: now.getTime(),
      }
      const message = toPublicMessage(row, channel, now)
      const eventId = createChatPublicationId()
      const event: PublicChatMessageEvent = {
        type: 'message',
        eventId,
        message,
      }
      database
        .prepare(
          `INSERT INTO chat_outbox (
          id, message_id, channel_name, payload, next_attempt_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          eventId,
          messageId,
          chatTranscriptChannel(channel.id),
          JSON.stringify(event),
          now.getTime(),
          now.getTime(),
        )
      return message
    })
    .immediate()
}
