import 'server-only'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setImmediate } from 'node:timers/promises'
import { closeChatDatabase } from '@/lib/chat-database'
import { getDatabase } from '@/lib/auth/database'
import { chatEnvironment, isChatEnabled } from '@/lib/chat-environment'
import { waitForChatRetention } from '@/lib/chat-retention'
import { drainChatOutboxDispatch } from '@/lib/chat-outbox'
import {
  chatTranscriptChannel,
  clearChatRecoveryHistory,
  reconnectChatParticipant,
} from '@/lib/chat-realtime'
import { purgeExpiredChat } from '@/scripts/chat-retention.mjs'

const state = globalThis as typeof globalThis & {
  chatRestoreRunning?: boolean
}
async function validateChatReferences(
  database: Database.Database,
): Promise<void> {
  const auth = getDatabase()
  const account = auth.prepare('SELECT 1 FROM user WHERE id = ?')
  const channel = auth.prepare('SELECT 1 FROM channel WHERE id = ?')
  let checked = 0
  for (const row of database
    .prepare(
      `
    SELECT account_id AS id FROM chat_participant UNION SELECT account_id FROM chat_message
    UNION SELECT account_id FROM chat_restriction UNION SELECT actor_account_id FROM chat_moderation_record
    UNION SELECT target_account_id FROM chat_moderation_record`,
    )
    .iterate() as Iterable<{ id: string }>) {
    if (!account.get(row.id))
      throw new Error('Chat account reference is missing')
    if (++checked % 500 === 0) await setImmediate()
  }
  for (const row of database
    .prepare('SELECT channel_id AS id FROM chat_room')
    .iterate() as Iterable<{ id: string }>) {
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

export async function restoreChat(): Promise<void> {
  if (state.chatRestoreRunning)
    throw new Error('Chat restore is already running')
  state.chatRestoreRunning = true
  const path = chatEnvironment.databasePath
  const marker = `${path}.maintenance`
  const candidate = `${path}.restore-candidate`
  let restored: Database.Database | undefined
  let live: Database.Database | undefined
  try {
    // Keep the marker on failure or process exit. Only a successful retry opens Chat.
    const previousRooms: string[] = existsSync(marker)
      ? JSON.parse(readFileSync(marker, 'utf8'))
      : []
    writeFileSync(marker, JSON.stringify(previousRooms), { mode: 0o600 })
    await drainChatOutboxDispatch()
    await waitForChatRetention()
    await promisify(execFile)(process.execPath, [
      'scripts/prepare-chat-restore.mjs',
      candidate,
    ])
    restored = new Database(candidate, { fileMustExist: true })
    restored.pragma('foreign_keys = ON')
    await validateChatReferences(restored)
    const channels = new Set(previousRooms)
    // Authentication retains Channel identities even if the live Chat file is lost.
    for (const { id } of getDatabase()
      .prepare('SELECT id FROM channel')
      .all() as { id: string }[])
      channels.add(id)
    try {
      live = new Database(path, { fileMustExist: true, timeout: 100 })
      for (const { id } of live
        .prepare('SELECT channel_id AS id FROM chat_room')
        .all() as { id: string }[])
        channels.add(id)
    } catch {
      // A missing or corrupt live database must not prevent recovery.
    }
    for (const db of [restored]) {
      for (const row of db
        .prepare('SELECT channel_id AS id FROM chat_room')
        .all() as { id: string }[])
        channels.add(row.id)
    }
    writeFileSync(marker, JSON.stringify([...channels]), { mode: 0o600 })
    if (isChatEnabled()) {
      for (const id of channels)
        await clearChatRecoveryHistory(chatTranscriptChannel(id))
    }
    // All application Chat users pass the maintenance gate. The dispatcher is
    // drained and health checks close their connections before awaiting I/O.
    live?.close()
    live = undefined
    closeChatDatabase()
    restored.close()
    restored = undefined
    for (const suffix of ['-wal', '-shm'])
      rmSync(`${path}${suffix}`, { force: true })
    renameSync(candidate, path)
    live = new Database(path)
    live.pragma('foreign_keys = ON')
    live.pragma('journal_mode = WAL')
    purgeExpiredChat(live)
    writeFileSync(`${path}.generation`, randomUUID(), { mode: 0o600 })
    // No token can be issued while the marker exists. Existing clients reconnect
    // and reload the transcript after the restore has committed.
    if (isChatEnabled()) {
      const accounts = getDatabase().prepare('SELECT id FROM user').all() as {
        id: string
      }[]
      for (const { id } of accounts) await reconnectChatParticipant(id)
    }
    const runtime = globalThis as typeof globalThis & {
      chatRetentionFailed?: boolean
    }
    runtime.chatRetentionFailed = false
    rmSync(marker)
    for (const suffix of ['', '-wal', '-shm'])
      rmSync(`${candidate}${suffix}`, { force: true })
  } finally {
    restored?.close()
    live?.close()
    state.chatRestoreRunning = false
  }
}
