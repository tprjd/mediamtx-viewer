import 'server-only'

import { createHmac, randomUUID } from 'node:crypto'

import { getDatabase } from '@/lib/auth/database'
import { getChatDatabase } from '@/lib/chat-database'
import { chatEnvironment } from '@/lib/chat-environment'
import { allocateChatAuthorTag, normalizeChatMessage } from '@/lib/chat-rules'
import type {
  ChatHistoryPage,
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

interface ChatMessageRow {
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
  messageId?: string
}

function createAuthorTagDigest(roomId: string, accountId: string): string {
  return createHmac('sha256', chatEnvironment.tagHmacSecret)
    .update(roomId)
    .update('\0')
    .update(accountId)
    .digest('hex')
}

function currentBadges(
  accountId: string,
  channel: ChatChannelReference,
): Array<'admin' | 'owner'> {
  const account = getDatabase()
    .prepare('SELECT role, activationStatus FROM user WHERE id = ?')
    .get(accountId) as
    | { role: string | null; activationStatus: string }
    | undefined
  if (!account || account.activationStatus !== 'active') return []

  const badges: Array<'admin' | 'owner'> = []
  if (account.role === 'admin') badges.push('admin')
  if (accountId === channel.ownerUserId) badges.push('owner')
  return badges
}

function toPublicMessage(
  row: ChatMessageRow,
  channel: ChatChannelReference,
): PublicChatMessage {
  return {
    id: row.id,
    sequence: row.sequence,
    content: row.content,
    profileName: row.profileName,
    authorTag: row.authorTag,
    badges: currentBadges(row.accountId, channel),
    serverTimestamp: new Date(row.createdAt).toISOString(),
  }
}

export function sendChatMessage({
  channel,
  participant,
  rawContent,
  now = new Date(),
  messageId = randomUUID(),
}: SendChatMessageInput): PublicChatMessage {
  const content = normalizeChatMessage(rawContent)
  const database = getChatDatabase()

  return database.transaction(() => {
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

    let participantRow = database
      .prepare(
        `SELECT author_tag AS authorTag FROM chat_participant
         WHERE room_id = ? AND account_id = ?`,
      )
      .get(room.id, participant.accountId) as { authorTag: string } | undefined
    if (!participantRow) {
      const existingTags = new Set(
        (
          database
            .prepare('SELECT author_tag AS authorTag FROM chat_participant WHERE room_id = ?')
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
      .prepare('UPDATE chat_room SET next_sequence = ? WHERE id = ?')
      .run(room.nextSequence + 1, room.id)
    database
      .prepare(
        `INSERT INTO chat_message (
          id, room_id, room_sequence, account_id, profile_name,
          author_tag, content, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
      )

    const row = {
      id: messageId,
      sequence: room.nextSequence,
      accountId: participant.accountId,
      profileName: participant.profileName,
      authorTag: participantRow.authorTag,
      content,
      createdAt: now.getTime(),
    }
    const message = toPublicMessage(row, channel)
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
  })()
}

const HISTORY_PAGE_SIZE = 100
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const HISTORY_CURSOR_PREFIX = 'chat-history-v1:'
const HISTORY_CURSOR_PATTERN = /^\d+$/

export class InvalidChatHistoryCursorError extends Error {}

function encodeChatHistoryCursor(sequence: number): string {
  return `${HISTORY_CURSOR_PREFIX}${sequence}`
}

function decodeChatHistoryCursor(cursor: string): number | null {
  if (!cursor.startsWith(HISTORY_CURSOR_PREFIX)) return null
  const rawSequence = cursor.slice(HISTORY_CURSOR_PREFIX.length)
  if (!HISTORY_CURSOR_PATTERN.test(rawSequence)) return null
  const sequence = Number(rawSequence)
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null
  return sequence
}

export function loadLatestChatHistory(
  channel: ChatChannelReference,
  now = new Date(),
): ChatHistoryPage {
  const cutoff = now.getTime() - HISTORY_RETENTION_MS
  const rows = getChatDatabase()
    .prepare(
      `SELECT * FROM (
         SELECT message.id, message.room_sequence AS sequence,
                message.account_id AS accountId,
                message.profile_name AS profileName,
                message.author_tag AS authorTag, message.content,
                message.created_at AS createdAt
         FROM chat_message message
         JOIN chat_room room ON room.id = message.room_id
         WHERE room.channel_id = ? AND message.created_at >= ?
         ORDER BY message.room_sequence DESC
         LIMIT ?
       ) ORDER BY sequence ASC`,
    )
    .all(channel.id, cutoff, HISTORY_PAGE_SIZE + 1) as ChatMessageRow[]

  const hasMore = rows.length > HISTORY_PAGE_SIZE
  const selectedRows = hasMore ? rows.slice(1) : rows
  return {
    messages: selectedRows.map((row) => toPublicMessage(row, channel)),
    hasMore,
    cursor: hasMore ? encodeChatHistoryCursor(selectedRows[0].sequence) : null,
  }
}

const GAP_REPAIR_PAGE_SIZE = 300

export function loadChatMessagesAfter(
  channel: ChatChannelReference,
  afterSequence: number,
  now = new Date(),
): { messages: PublicChatMessage[]; hasMore: boolean } {
  const cutoff = now.getTime() - HISTORY_RETENTION_MS
  const rows = getChatDatabase()
    .prepare(
      `SELECT message.id, message.room_sequence AS sequence,
              message.account_id AS accountId,
              message.profile_name AS profileName,
              message.author_tag AS authorTag, message.content,
              message.created_at AS createdAt
       FROM chat_message message
       JOIN chat_room room ON room.id = message.room_id
       WHERE room.channel_id = ?
         AND message.room_sequence > ?
         AND message.created_at >= ?
       ORDER BY message.room_sequence ASC
       LIMIT ?`,
    )
    .all(
      channel.id,
      afterSequence,
      cutoff,
      GAP_REPAIR_PAGE_SIZE + 1,
    ) as ChatMessageRow[]
  const hasMore = rows.length > GAP_REPAIR_PAGE_SIZE
  return {
    messages: rows
      .slice(0, GAP_REPAIR_PAGE_SIZE)
      .map((row) => toPublicMessage(row, channel)),
    hasMore,
  }
}

export function loadOlderChatMessages(
  channel: ChatChannelReference,
  cursor: string,
  now = new Date(),
): ChatHistoryPage {
  const beforeSequence = decodeChatHistoryCursor(cursor)
  if (beforeSequence === null) {
    throw new InvalidChatHistoryCursorError('Invalid Chat history cursor.')
  }
  const cutoff = now.getTime() - HISTORY_RETENTION_MS
  const rows = getChatDatabase()
    .prepare(
      `SELECT message.id, message.room_sequence AS sequence,
              message.account_id AS accountId,
              message.profile_name AS profileName,
              message.author_tag AS authorTag, message.content,
              message.created_at AS createdAt
       FROM chat_message message
       JOIN chat_room room ON room.id = message.room_id
       WHERE room.channel_id = ?
         AND message.created_at >= ?
         AND message.room_sequence < ?
       ORDER BY message.room_sequence DESC
       LIMIT ?`,
    )
    .all(
      channel.id,
      cutoff,
      beforeSequence,
      HISTORY_PAGE_SIZE + 1,
    ) as ChatMessageRow[]

  const selectedRows = rows.slice(0, HISTORY_PAGE_SIZE)
  const lastRow = selectedRows.at(-1)
  return {
    messages: selectedRows
      .toReversed()
      .map((row) => toPublicMessage(row, channel)),
    hasMore: rows.length > HISTORY_PAGE_SIZE,
    cursor:
      lastRow === undefined || rows.length <= HISTORY_PAGE_SIZE
        ? null
        : encodeChatHistoryCursor(lastRow.sequence),
  }
}
