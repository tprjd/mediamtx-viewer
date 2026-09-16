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
      expiresAt: number | null
      actorRole: string
    }
  | undefined {
  return getChatDatabase()
    .prepare(
      `
    SELECT restriction.category, restriction.expires_at AS expiresAt, restriction.actor_role AS actorRole
    FROM chat_restriction restriction
    JOIN chat_room room ON room.id = restriction.room_id
    WHERE room.channel_id = ? AND restriction.account_id = ? AND (restriction.expires_at IS NULL OR restriction.expires_at > ?)
  `,
    )
    .get(channelId, accountId, now.getTime()) as
    | {
        category: ChatRestriction['category']
        expiresAt: number | null
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
        expiresAt:
          restriction.expiresAt === null
            ? null
            : new Date(restriction.expiresAt).toISOString(),
      }
    : null
}

export class ChatRestrictionError extends Error {
  constructor(readonly restriction: ChatRestriction) {
    super(
      restriction.expiresAt === null
        ? 'Chat ban is active.'
        : 'Chat timeout is active.',
    )
  }
}
