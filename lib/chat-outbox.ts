import 'server-only'

import { getChatDatabase } from '@/lib/chat-database'
import {
  getChatRuntimeConfigurationErrors,
  isChatEnabled,
} from '@/lib/chat-environment'
import { clearChatRecoveryHistory, publishChatEvent } from '@/lib/chat-realtime'

interface ChatOutboxRow {
  id: string
  channelName: string
  payload: string
  attemptCount: number
}

const globalDispatcher = globalThis as typeof globalThis & {
  chatOutboxDispatchTail?: Promise<unknown>
  chatOutboxDispatcherStarted?: boolean
  chatOutboxDispatchQueued?: boolean
}

function retryDelayMilliseconds(attemptCount: number): number {
  return Math.min(30_000, 500 * 2 ** Math.min(attemptCount, 6))
}

export function dispatchNextChatOutboxEvent(
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<boolean> {
  // Serialize publication and cache removal across the timer and HTTP dispatches.
  const dispatch = (
    globalDispatcher.chatOutboxDispatchTail ?? Promise.resolve()
  )
    .catch(() => undefined)
    .then(() => dispatchNextEvent(fetcher, now))
  globalDispatcher.chatOutboxDispatchTail = dispatch
  return dispatch
}

async function dispatchNextEvent(
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<boolean> {
  const database = getChatDatabase()
  const row = database
    .prepare(
      `SELECT id, channel_name AS channelName, payload,
              attempt_count AS attemptCount
       FROM chat_outbox AS event
       WHERE next_attempt_at <= ?
         AND (json_extract(payload, '$.type') = 'history-cleared' OR NOT EXISTS (
           SELECT 1 FROM chat_outbox AS pending
           WHERE pending.channel_name = event.channel_name
             AND json_extract(pending.payload, '$.type') = 'history-cleared'
         ))
       ORDER BY created_at ASC
       LIMIT 1`,
    )
    .get(now.getTime()) as ChatOutboxRow | undefined
  if (!row) return false

  try {
    const event = JSON.parse(row.payload)
    if (event.message?.removed === true || event.type === 'history-cleared') {
      await clearChatRecoveryHistory(row.channelName, fetcher)
    }
    await publishChatEvent(row.channelName, event, row.id, fetcher)
    database.prepare('DELETE FROM chat_outbox WHERE id = ?').run(row.id)
    return true
  } catch {
    const attemptCount = row.attemptCount + 1
    database
      .prepare(
        `UPDATE chat_outbox
         SET attempt_count = ?, next_attempt_at = ?
         WHERE id = ?`,
      )
      .run(
        attemptCount,
        now.getTime() + retryDelayMilliseconds(attemptCount),
        row.id,
      )
    return false
  }
}

export async function dispatchChatOutboxBatch(
  fetcher: typeof fetch = fetch,
  maximumEvents = 100,
): Promise<number> {
  let published = 0
  while (published < maximumEvents) {
    if (!(await dispatchNextChatOutboxEvent(fetcher))) break
    published += 1
  }
  return published
}

function scheduleNextDispatch(delay: number): void {
  const timer = setTimeout(async () => {
    try {
      await dispatchChatOutboxBatch()
    } catch {
      // The next interval retries after startup or storage failures.
    } finally {
      scheduleNextDispatch(1_000)
    }
  }, delay)
  timer.unref()
}

export function startChatOutboxDispatcher(): void {
  if (
    globalDispatcher.chatOutboxDispatcherStarted ||
    !isChatEnabled() ||
    getChatRuntimeConfigurationErrors().length > 0
  ) {
    return
  }
  globalDispatcher.chatOutboxDispatcherStarted = true
  scheduleNextDispatch(0)
}

export function requestChatOutboxDispatch(): void {
  if (globalDispatcher.chatOutboxDispatchQueued) return
  globalDispatcher.chatOutboxDispatchQueued = true
  queueMicrotask(async () => {
    try {
      await dispatchChatOutboxBatch()
    } catch {
      // The background interval retries after startup or storage failures.
    } finally {
      globalDispatcher.chatOutboxDispatchQueued = false
    }
  })
}

export async function drainChatOutboxDispatch(): Promise<void> {
  await globalDispatcher.chatOutboxDispatchTail?.catch(() => undefined)
}
