import 'server-only'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chatEnvironment } from '@/lib/chat-environment'
import { isChatRestoring } from '@/lib/chat-maintenance'

const state = globalThis as typeof globalThis & {
  chatRetentionTimer?: NodeJS.Timeout
  chatRetentionPending?: Promise<void>
  chatRetentionFailed?: boolean
}

export async function waitForChatRetention(): Promise<void> {
  await state.chatRetentionPending
}

export async function startChatRetention(): Promise<void> {
  if (state.chatRetentionTimer) return
  const cleanup = (): Promise<void> => {
    if (isChatRestoring()) return Promise.resolve()
    if (state.chatRetentionPending) return state.chatRetentionPending
    state.chatRetentionPending = promisify(execFile)(process.execPath, [
      'scripts/cleanup-chat.mjs',
      chatEnvironment.databasePath,
    ])
      .then(() => {
        state.chatRetentionFailed = false
      })
      .catch(() => {
        state.chatRetentionFailed = true
        console.error(
          JSON.stringify({
            event: 'chat-retention',
            result: 'failed',
            code: 'CLEANUP_FAILED',
          }),
        )
      })
      .finally(() => {
        state.chatRetentionPending = undefined
      })
    return state.chatRetentionPending
  }
  state.chatRetentionFailed = true
  state.chatRetentionTimer = setInterval(
    () => {
      void cleanup()
    },
    60 * 60 * 1000,
  )
  state.chatRetentionTimer.unref()
  await cleanup()
}
