import { describe, expect, it } from 'vitest'

import {
  CHAT_PREFERENCE_STORAGE_KEY,
  isChatPreference,
  readChatPreference,
} from '@/lib/chat-preferences'

describe('chat preferences', () => {
  it('defaults to an open chat panel', () => {
    expect(readChatPreference(null)).toBe('open')
  })

  it('reads a saved closed preference', () => {
    const storage = new Map<string, string>([
      [CHAT_PREFERENCE_STORAGE_KEY, 'closed'],
    ])

    expect(readChatPreference({ getItem: (key) => storage.get(key) ?? null })).toBe(
      'closed',
    )
  })

  it('ignores invalid saved preferences', () => {
    const storage = new Map<string, string>([
      [CHAT_PREFERENCE_STORAGE_KEY, 'collapsed'],
    ])

    expect(readChatPreference({ getItem: (key) => storage.get(key) ?? null })).toBe(
      'open',
    )
  })

  it('recognizes only open and closed values', () => {
    expect(isChatPreference('open')).toBe(true)
    expect(isChatPreference('closed')).toBe(true)
    expect(isChatPreference('expanded')).toBe(false)
  })
})
