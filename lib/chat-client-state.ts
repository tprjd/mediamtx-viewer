import type { PublicChatMessage } from '@/lib/chat-types'

export function mergeChatMessages(
  current: PublicChatMessage[],
  incoming: PublicChatMessage[],
): PublicChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence)
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
