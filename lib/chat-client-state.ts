import type { PublicChatMessage } from '@/lib/chat-types'

export function mergeChatMessages(
  current: PublicChatMessage[],
  incoming: PublicChatMessage[],
): PublicChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].sort(
    (left, right) => left.sequence - right.sequence,
  )
}

export function mergeChatHistoryPages(
  current: PublicChatMessage[],
  older: PublicChatMessage[],
): PublicChatMessage[] {
  if (current.length === 0 || older.length === 0) {
    return mergeChatMessages(current, older)
  }
  const newestVisible = current[0]
  return mergeChatMessages(
    older.filter((message) => message.sequence < newestVisible.sequence),
    current,
  )
}

export function firstChatSequenceGap(
  messages: PublicChatMessage[],
): number | null {
  for (let index = 1; index < messages.length; index += 1) {
    if (messages[index].sequence > messages[index - 1].sequence + 1) {
      return messages[index - 1].sequence
    }
  }
  return null
}

export function chatRequestBlocksSending(status: number): boolean {
  return [401, 403, 409, 503].includes(status)
}

// Publish a correlation value without publishing the client's Retry key.
export async function createChatSubmissionId(key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
