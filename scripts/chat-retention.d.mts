import type Database from 'better-sqlite3'
export const CHAT_RETENTION_MS: number
export function purgeExpiredChat(
  database: Database.Database,
  now?: number,
): void
