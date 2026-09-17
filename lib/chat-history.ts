import 'server-only'
import { chatRestoreGeneration } from '@/lib/chat-maintenance'

import { randomUUID } from 'node:crypto'
import type { ChatChannelReference } from '@/lib/chat'
import { getChatDatabase } from '@/lib/chat-database'
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
  return { clearedThrough: row?.clearedThrough ?? 0, clearPending: Boolean(row?.clearPending) }
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
      type: 'history-cleared', restoreGeneration: chatRestoreGeneration(), clearedThrough: room.clearedThrough,
    }), now, now)
    return { clearedThrough: room.clearedThrough, clearPending: true }
  }).immediate()
}
