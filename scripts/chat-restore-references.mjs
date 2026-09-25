import { setImmediate } from 'node:timers/promises'

export const CHAT_OWNER_PROTECTION_ACTOR = 'system:channel-owner-protection'

export async function validateChatReferences(database, auth) {
  const account = auth.prepare('SELECT 1 FROM user WHERE id = ?')
  const channel = auth.prepare('SELECT 1 FROM channel WHERE id = ?')
  let checked = 0
  for (const row of database
    .prepare(
      `
    SELECT account_id AS id FROM chat_participant UNION SELECT account_id FROM chat_message
    UNION SELECT account_id FROM chat_restriction
    UNION SELECT actor_account_id FROM chat_moderation_record
      WHERE actor_account_id != ? OR action != 'reversal' OR actor_role IS NOT NULL
    UNION SELECT target_account_id FROM chat_moderation_record`,
    )
    .iterate(CHAT_OWNER_PROTECTION_ACTOR)) {
    if (!account.get(row.id))
      throw new Error('Chat account reference is missing')
    if (++checked % 500 === 0) await setImmediate()
  }
  for (const row of database
    .prepare('SELECT channel_id AS id FROM chat_room')
    .iterate()) {
    if (!channel.get(row.id))
      throw new Error('Chat Channel reference is missing')
    if (++checked % 500 === 0) await setImmediate()
  }
  if (
    database
      .prepare(
        'SELECT 1 FROM chat_moderation_record m LEFT JOIN chat_room r ON r.id = m.room_id WHERE r.id IS NULL LIMIT 1',
      )
      .get()
  )
    throw new Error('Chat room reference is missing')
}
