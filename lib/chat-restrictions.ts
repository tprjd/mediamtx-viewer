import 'server-only'

import { getChatDatabase } from '@/lib/chat-database'
import type { ChatRestriction } from '@/lib/chat-types'

export function getActiveChatRestriction(
  channelId: string,
  accountId: string,
  now = new Date(),
):
  | {
      category: ChatRestriction['category']
      expiresAt: number
      actorRole: string
    }
  | undefined {
  return getChatDatabase()
    .prepare(
      `
    SELECT record.category, record.expires_at AS expiresAt, record.actor_role AS actorRole
    FROM chat_restriction restriction
    JOIN chat_room room ON room.id = restriction.room_id
    JOIN chat_moderation_record record ON record.id = restriction.record_id
    WHERE room.channel_id = ? AND restriction.account_id = ? AND record.expires_at > ?
  `,
    )
    .get(channelId, accountId, now.getTime()) as
    | {
        category: ChatRestriction['category']
        expiresAt: number
        actorRole: string
      }
    | undefined
}

export function getChatRestriction(
  channelId: string,
  accountId: string,
  now = new Date(),
): ChatRestriction | null {
  const restriction = getActiveChatRestriction(channelId, accountId, now)
  return restriction
    ? {
        category: restriction.category,
        expiresAt: new Date(restriction.expiresAt).toISOString(),
      }
    : null
}

export class ChatRestrictionError extends Error {
  constructor(readonly restriction: ChatRestriction) {
    super('Chat timeout is active.')
  }
}
