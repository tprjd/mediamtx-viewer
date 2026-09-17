import 'server-only'

import { randomUUID } from 'node:crypto'
import {
  toPublicMessage,
  type ChatChannelReference,
  type ChatMessageRow,
} from '@/lib/chat'
import type { ChatHistoryPage } from '@/lib/chat-types'
import { getChatDatabase } from '@/lib/chat-database'
import { chatRestoreGeneration } from '@/lib/chat-maintenance'
import { requireChatAdministrator } from '@/lib/chat-moderation'
import { chatTranscriptChannel } from '@/lib/chat-realtime'

export function getChatHistoryState(channelId: string) {
  const row = getChatDatabase().prepare(`
    SELECT cleared_through AS clearedThrough,
      EXISTS (SELECT 1 FROM chat_outbox WHERE channel_name = ?
        AND json_extract(payload, '$.type') = 'history-cleared') AS clearPending
    FROM chat_room WHERE channel_id = ?
  `).get(chatTranscriptChannel(channelId), channelId) as
    { clearedThrough: number; clearPending: number } | undefined
  return {
    clearedThrough: row?.clearedThrough ?? 0,
    clearPending: Boolean(row?.clearPending),
    restoreGeneration: chatRestoreGeneration(),
  }
}

export function clearChatHistory(channel: ChatChannelReference, actorId: string) {
  requireChatAdministrator(actorId)
  const database = getChatDatabase()
  database.pragma('secure_delete = ON')
  return database.transaction(() => {
    const state = getChatHistoryState(channel.id)
    if (state.clearPending) return state
    const room = database.prepare(`
      SELECT id, next_sequence - 1 AS clearedThrough FROM chat_room WHERE channel_id = ?
    `).get(channel.id) as { id: string; clearedThrough: number } | undefined
    if (!room) return state
    database.prepare(`
      INSERT OR IGNORE INTO chat_cleared_submission
      SELECT room_id, account_id, client_idempotency_key FROM chat_message
      WHERE room_id = ? AND client_idempotency_key IS NOT NULL
    `).run(room.id)
    // Deletion also removes queued message payloads through their foreign key.
    database.prepare('DELETE FROM chat_message WHERE room_id = ?').run(room.id)
    database.prepare('UPDATE chat_room SET cleared_through = ? WHERE id = ?')
      .run(room.clearedThrough, room.id)
    const now = Date.now()
    database.prepare(`
      INSERT INTO chat_outbox (id, channel_name, payload, next_attempt_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), chatTranscriptChannel(channel.id), JSON.stringify({
      type: 'history-cleared', restoreGeneration: state.restoreGeneration, clearedThrough: room.clearedThrough,
    }), now, now)
    return { ...state, clearedThrough: room.clearedThrough, clearPending: true }
  }).immediate()
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

interface RetainedChatRowsOptions {
  order: 'ASC' | 'DESC'
  revisions?: boolean
  pageSize: number
  sequence?: {
    operator: '>' | '<'
    value: number
  }
}

function loadRetainedChatRows(
  channel: ChatChannelReference,
  now: Date,
  options: RetainedChatRowsOptions,
): ChatMessageRow[] {
  const currentTime = now.getTime()
  const cutoff = currentTime - HISTORY_RETENTION_MS
  const sequenceColumn = options.revisions
    ? 'COALESCE(message.removed_sequence, message.room_sequence)'
    : 'message.room_sequence'
  const sequencePredicate = options.sequence
    ? `AND ${sequenceColumn} ${options.sequence.operator} ?`
    : ''
  const parameters = options.sequence
    ? [
        channel.id,
        cutoff,
        currentTime,
        options.sequence.value,
        options.pageSize + 1,
      ]
    : [channel.id, cutoff, currentTime, options.pageSize + 1]
  return getChatDatabase()
    .prepare(
      `SELECT message.id, message.room_sequence AS sequence,
              message.account_id AS accountId,
              message.profile_name AS profileName,
              message.author_tag AS authorTag, message.content,
              message.created_at AS createdAt,
              message.client_idempotency_key AS clientIdempotencyKey,
              message.removed_sequence AS removedSequence
       FROM chat_message message
       JOIN chat_room room ON room.id = message.room_id
       WHERE room.channel_id = ?
         AND message.created_at >= ?
         AND message.created_at <= ?
         ${sequencePredicate}
       ORDER BY ${sequenceColumn} ${options.order}
       LIMIT ?`,
    )
    .all(...parameters) as ChatMessageRow[]
}

function toChatHistoryPage(
  rows: ChatMessageRow[],
  channel: ChatChannelReference,
  now: Date,
): ChatHistoryPage {
  const hasMore = rows.length > HISTORY_PAGE_SIZE
  const selectedRows = rows.slice(0, HISTORY_PAGE_SIZE).toReversed()
  return {
    messages: selectedRows.map((row) => toPublicMessage(row, channel, now)),
    hasMore,
    cursor:
      hasMore && selectedRows[0]
        ? encodeChatHistoryCursor(selectedRows[0].sequence)
        : null,
  }
}

export function loadLatestChatHistory(
  channel: ChatChannelReference,
  now = new Date(),
) {
  return {
    ...toChatHistoryPage(
      loadRetainedChatRows(channel, now, {
        order: 'DESC',
        pageSize: HISTORY_PAGE_SIZE,
      }),
      channel,
      now,
    ),
    ...getChatHistoryState(channel.id),
  }
}

const GAP_REPAIR_PAGE_SIZE = 300

export function loadChatMessagesAfter(
  channel: ChatChannelReference,
  afterSequence: number,
  now = new Date(),
) {
  const rows = loadRetainedChatRows(channel, now, {
    order: 'ASC',
    revisions: true,
    pageSize: GAP_REPAIR_PAGE_SIZE,
    sequence: { operator: '>', value: afterSequence },
  })
  const hasMore = rows.length > GAP_REPAIR_PAGE_SIZE
  return {
    messages: rows
      .slice(0, GAP_REPAIR_PAGE_SIZE)
      .map((row) => toPublicMessage(row, channel, now)),
    hasMore,
    ...getChatHistoryState(channel.id),
  }
}

export function loadOlderChatMessages(
  channel: ChatChannelReference,
  cursor: string,
  now = new Date(),
) {
  const beforeSequence = decodeChatHistoryCursor(cursor)
  if (beforeSequence === null) {
    throw new InvalidChatHistoryCursorError('Invalid Chat history cursor.')
  }
  return {
    ...toChatHistoryPage(
      loadRetainedChatRows(channel, now, {
        order: 'DESC',
        pageSize: HISTORY_PAGE_SIZE,
        sequence: { operator: '<', value: beforeSequence },
      }),
      channel,
      now,
    ),
    ...getChatHistoryState(channel.id),
  }
}
