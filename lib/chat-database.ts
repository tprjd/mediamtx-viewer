import 'server-only'

import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { assertChatAvailable } from '@/lib/chat-maintenance'

import { chatEnvironment } from '@/lib/chat-environment'
import { getDatabase } from '@/lib/auth/database'
import { chatControlChannel } from '@/lib/chat-realtime'

// This reserved actor identifies a policy change, never a human account.
export const CHAT_OWNER_PROTECTION_ACTOR = 'system:channel-owner-protection'

const globalDatabase = globalThis as typeof globalThis & {
  chatDatabase?: Database.Database
}

function createChatDatabase(): Database.Database {
  mkdirSync(dirname(chatEnvironment.databasePath), { recursive: true })
  const database = new Database(chatEnvironment.databasePath, { timeout: 100 })
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  try {
    liftOwnerRestrictions(database)
  } catch (error) {
    database.close()
    throw error
  }
  return database
}

function liftOwnerRestrictions(database: Database.Database): void {
  const owner = getDatabase().prepare(
    'SELECT 1 FROM channel WHERE id = ? AND owner_user_id = ?',
  )
  const now = Date.now()
  database
    .transaction(() => {
      const restrictions = database
        .prepare(
          `
      SELECT r.room_id AS roomId, room.channel_id AS channelId,
        r.account_id AS accountId, r.record_id AS recordId, r.category
      FROM chat_restriction r JOIN chat_room room ON room.id = r.room_id
      WHERE r.expires_at IS NULL OR r.expires_at > ?
    `,
        )
        .all(now) as Array<{
        roomId: string
        channelId: string
        accountId: string
        recordId: string
        category: string
      }>
      for (const restriction of restrictions) {
        if (!owner.get(restriction.channelId, restriction.accountId)) continue
        database
          .prepare(
            `INSERT INTO chat_moderation_record
        (id, action, category, actor_account_id, target_account_id, room_id, created_at, source_record_id)
        VALUES (?, 'reversal', ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            restriction.category,
            CHAT_OWNER_PROTECTION_ACTOR,
            restriction.accountId,
            restriction.roomId,
            now,
            restriction.recordId,
          )
        database
          .prepare(
            'UPDATE chat_moderation_record SET reversed_at = ? WHERE id = ?',
          )
          .run(now, restriction.recordId)
        database
          .prepare(
            'DELETE FROM chat_restriction WHERE room_id = ? AND account_id = ?',
          )
          .run(restriction.roomId, restriction.accountId)
        database
          .prepare(
            `INSERT INTO chat_outbox
        (id, channel_name, payload, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            chatControlChannel(restriction.accountId),
            JSON.stringify({
              type: 'restriction',
              channelId: restriction.channelId,
            }),
            now,
            now,
          )
      }
    })
    .immediate()
}

export function getChatDatabase(): Database.Database {
  assertChatAvailable()
  globalDatabase.chatDatabase ??= createChatDatabase()
  return globalDatabase.chatDatabase
}

export function closeChatDatabase(): void {
  globalDatabase.chatDatabase?.close()
  globalDatabase.chatDatabase = undefined
}
