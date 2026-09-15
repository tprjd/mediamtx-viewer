import type { PublicChatMessage } from '@/lib/chat-types'

export function mergeChatMessages(
  current: PublicChatMessage[],
  incoming: PublicChatMessage[],
): PublicChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) {
    const existing = byId.get(message.id)
    if (
      existing &&
      chatMessageRevision(existing) > chatMessageRevision(message)
    )
      continue
    byId.set(message.id, message)
  }
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
  const currentIds = new Set(current.map(({ id }) => id))
  return mergeChatMessages(
    older.filter(
      (message) =>
        message.sequence < newestVisible.sequence || currentIds.has(message.id),
    ),
    current,
  )
}

export function chatMessageRevision(message: PublicChatMessage): number {
  return message.revisionSequence ?? message.sequence
}

export function latestChatSequence(messages: PublicChatMessage[]): number {
  return messages.reduce(
    (latest, message) => Math.max(latest, chatMessageRevision(message)),
    0,
  )
}

export function firstChatSequenceGap(
  messages: PublicChatMessage[],
): number | null {
  const sequences = [
    ...new Set(
      messages.flatMap((message) => [
        message.sequence,
        chatMessageRevision(message),
      ]),
    ),
  ].sort((left, right) => left - right)
  for (let index = 1; index < sequences.length; index += 1) {
    if (sequences[index] > sequences[index - 1] + 1) return sequences[index - 1]
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
