import 'server-only'

import type Database from 'better-sqlite3'
import { statSync, statfsSync } from 'node:fs'
import { dirname } from 'node:path'
import { chatEnvironment } from '@/lib/chat-environment'

function byteLimit(name: string, fallback: number): number {
  const value = process.env[name]
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error('Invalid Chat storage limit')
  return parsed
}

export function chatStorageLimits() {
  return {
    databaseLimitBytes: byteLimit('CHAT_DATABASE_LIMIT_BYTES', 2 * 1024 ** 3),
    minimumFreeBytes: byteLimit('CHAT_MINIMUM_FREE_BYTES', 10 * 1024 ** 3),
  }
}

export class ChatStorageLimitError extends Error {
  constructor() {
    super('Chat storage limit reached.')
  }
}

export function inspectChatStorage(database: Database.Database) {
  const limits = chatStorageLimits()
  const pageCount = database.pragma('page_count', { simple: true }) as number
  const pageSize = database.pragma('page_size', { simple: true }) as number
  // Include WAL growth as well as pages not yet checkpointed into the main file.
  let walBytes = 0
  try {
    walBytes = statSync(`${chatEnvironment.databasePath}-wal`).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const databaseBytes = Math.max(
    pageCount * pageSize,
    statSync(chatEnvironment.databasePath).size + walBytes,
  )
  const filesystem = statfsSync(dirname(chatEnvironment.databasePath))
  const freeBytes = filesystem.bavail * filesystem.bsize
  return {
    ...limits,
    databaseBytes,
    freeBytes,
    databaseLimitReached: databaseBytes >= limits.databaseLimitBytes,
    diskLimitReached: freeBytes < limits.minimumFreeBytes,
  }
}

export function assertChatMessageStorage(database: Database.Database): void {
  const storage = inspectChatStorage(database)
  if (storage.databaseLimitReached || storage.diskLimitReached)
    throw new ChatStorageLimitError()
}
