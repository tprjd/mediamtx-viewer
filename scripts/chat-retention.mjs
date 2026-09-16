export const CHAT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export function purgeExpiredChat(database, now = Date.now()) {
  const cutoff = now - CHAT_RETENTION_MS
  database.pragma('secure_delete = ON')
  database
    .transaction(() => {
      database
        .prepare('DELETE FROM chat_outbox WHERE created_at < ?')
        .run(cutoff)
      database
        .prepare('DELETE FROM chat_message WHERE created_at < ?')
        .run(cutoff)
      database
        .prepare(
          'UPDATE chat_moderation_record SET private_note = NULL WHERE created_at < ? AND private_note IS NOT NULL',
        )
        .run(cutoff)
    })
    .immediate()
}
