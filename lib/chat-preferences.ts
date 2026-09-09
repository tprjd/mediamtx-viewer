export const CHAT_PREFERENCE_STORAGE_KEY = 'home-stream.chat-preference'

export type ChatPreference = 'open' | 'closed'

export function isChatPreference(value: unknown): value is ChatPreference {
  return value === 'open' || value === 'closed'
}

export function readChatPreference(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): ChatPreference {
  if (!storage) return 'open'

  try {
    const value = storage.getItem(CHAT_PREFERENCE_STORAGE_KEY)
    return isChatPreference(value) ? value : 'open'
  } catch {
    return 'open'
  }
}
