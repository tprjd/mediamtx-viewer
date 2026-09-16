import 'server-only'

import Database from 'better-sqlite3'
import { inspectChatStorage } from '@/lib/chat-storage'
import {
  chatEnvironment,
  getChatRuntimeConfigurationErrors,
  isChatEnabled,
} from '@/lib/chat-environment'

export type ChatFault =
  | 'configuration'
  | 'database'
  | 'centrifugo'
  | 'outbox'
  | 'database-limit'
  | 'disk-limit'
  | 'disk-check'
export interface ChatHealth {
  status: 'disabled' | 'healthy' | 'degraded' | 'unavailable'
  faults: ChatFault[]
  uncheckedFaults: ChatFault[]
  outboxDepth: number | null
  oldestOutboxAgeSeconds: number | null
  databaseBytes: number | null
  freeBytes: number | null
  databaseLimitBytes: number
  minimumFreeBytes: number
}

export async function inspectChatHealth(
  fetcher: typeof fetch = fetch,
): Promise<ChatHealth> {
  const health: ChatHealth = {
    status: 'disabled',
    faults: [],
    uncheckedFaults: [],
    outboxDepth: null,
    oldestOutboxAgeSeconds: null,
    databaseBytes: null,
    freeBytes: null,
    databaseLimitBytes: 2 * 1024 ** 3,
    minimumFreeBytes: 10 * 1024 ** 3,
  }
  if (!isChatEnabled()) return health
  if (getChatRuntimeConfigurationErrors().length)
    health.faults.push('configuration')
  let database: Database.Database | undefined
  try {
    // A separate connection must never wait for a Chat writer or create a missing database.
    database = new Database(chatEnvironment.databasePath, {
      fileMustExist: true,
      timeout: 0,
    })
    database.exec('BEGIN IMMEDIATE')
    database.prepare('SELECT removed_sequence FROM chat_message LIMIT 1').get()
    database.prepare('SELECT next_sequence FROM chat_room LIMIT 1').get()
    database.prepare('SELECT expires_at FROM chat_restriction LIMIT 1').get()
    database
      .prepare('SELECT next_send_time FROM chat_participant LIMIT 1')
      .get()
    database
      .prepare('SELECT private_note FROM chat_moderation_record LIMIT 1')
      .get()
    const queue = database
      .prepare(
        'SELECT COUNT(*) AS depth, MIN(created_at) AS oldest FROM chat_outbox',
      )
      .get() as { depth: number; oldest: number | null }
    health.outboxDepth = queue.depth
    health.oldestOutboxAgeSeconds =
      queue.oldest === null
        ? 0
        : Math.max(0, Math.floor((Date.now() - queue.oldest) / 1000))
    try {
      const storage = inspectChatStorage(database)
      Object.assign(health, {
        databaseBytes: storage.databaseBytes,
        freeBytes: storage.freeBytes,
        databaseLimitBytes: storage.databaseLimitBytes,
        minimumFreeBytes: storage.minimumFreeBytes,
      })
      if (storage.databaseLimitReached) health.faults.push('database-limit')
      if (storage.diskLimitReached) health.faults.push('disk-limit')
    } catch {
      health.faults.push('disk-check')
      health.uncheckedFaults.push('database-limit', 'disk-limit')
    }
    if (queue.depth > 0) health.faults.push('outbox')
  } catch {
    health.faults.push('database')
    health.uncheckedFaults.push(
      'outbox',
      'database-limit',
      'disk-limit',
      'disk-check',
    )
  } finally {
    if (database?.inTransaction) database.exec('ROLLBACK')
    database?.close()
  }
  try {
    const response = await fetcher(`${chatEnvironment.centrifugoApiUrl}/info`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': chatEnvironment.centrifugoApiKey,
      },
      body: '{}',
      signal: AbortSignal.timeout(750),
    })
    const result = await response.json()
    if (!response.ok || result.error || !result.result)
      throw new Error('Centrifugo unavailable')
  } catch {
    health.faults.push('centrifugo')
  }
  health.status = health.faults.some(
    (fault) => fault === 'database' || fault === 'configuration',
  )
    ? 'unavailable'
    : health.faults.length
      ? 'degraded'
      : 'healthy'
  return health
}

const runtime = globalThis as typeof globalThis & {
  chatHealthPending?: Promise<ChatHealthReport>
  chatFaultsSince?: Partial<Record<ChatFault, number>>
  chatHealthStarted?: boolean
}
export interface ChatHealthReport extends ChatHealth {
  faultDetails: Array<{
    code: ChatFault
    since: string
    sustained: boolean
    checked: boolean
  }>
}

export function getChatHealth(): Promise<ChatHealthReport> {
  runtime.chatHealthPending ??= inspectChatHealth()
    .then((health) => {
      const now = Date.now()
      const previous = runtime.chatFaultsSince ?? {}
      const next: Partial<Record<ChatFault, number>> = {}
      for (const fault of health.faults) {
        next[fault] = previous[fault] ?? now
        if (previous[fault] === undefined) {
          console.info(
            JSON.stringify({
              event: 'chat-health',
              code: fault,
              result: 'failed',
            }),
          )
        }
      }
      for (const fault of Object.keys(previous) as ChatFault[]) {
        if (health.uncheckedFaults.includes(fault)) {
          next[fault] = previous[fault]
        } else if (!health.faults.includes(fault)) {
          console.info(
            JSON.stringify({
              event: 'chat-health',
              code: fault,
              result: 'recovered',
            }),
          )
        }
      }
      runtime.chatFaultsSince = next
      return {
        ...health,
        faultDetails: (Object.keys(next) as ChatFault[]).map((code) => ({
          checked: !health.uncheckedFaults.includes(code),
          code,
          since: new Date(next[code]!).toISOString(),
          sustained: now - next[code]! >= 300_000,
        })),
      }
    })
    .finally(() => {
      runtime.chatHealthPending = undefined
    })
  return runtime.chatHealthPending
}

export function startChatHealthMonitor(): void {
  if (runtime.chatHealthStarted || !isChatEnabled()) return
  runtime.chatHealthStarted = true
  const check = async () => {
    try {
      await getChatHealth()
    } finally {
      const timer = setTimeout(() => void check(), 10_000)
      timer.unref()
    }
  }
  void check()
}
