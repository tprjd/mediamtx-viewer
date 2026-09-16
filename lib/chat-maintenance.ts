import 'server-only'
import { existsSync, readFileSync } from 'node:fs'
import { chatEnvironment } from '@/lib/chat-environment'

export function isChatRestoring(): boolean {
  return existsSync(`${chatEnvironment.databasePath}.maintenance`)
}

export function assertChatAvailable(): void {
  const state = globalThis as typeof globalThis & {
    chatRetentionFailed?: boolean
  }
  if (isChatRestoring() || state.chatRetentionFailed)
    throw new Error('Chat is unavailable.')
}

export function chatRestoreGeneration(): string {
  try {
    return readFileSync(`${chatEnvironment.databasePath}.generation`, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'initial'
    throw error
  }
}
