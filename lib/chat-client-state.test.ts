import { describe, expect, it } from 'vitest'

import {
  firstChatSequenceGap,
  mergeChatMessages,
} from '@/lib/chat-client-state'
import type { PublicChatMessage } from '@/lib/chat-types'

function message(id: string, sequence: number): PublicChatMessage {
  return {
    id,
    sequence,
    content: id,
    profileName: 'Participant',
    authorTag: 'a1b2',
    badges: [],
    serverTimestamp: '2026-09-11T10:00:00.000Z',
  }
}

describe('Chat transcript merging', () => {
  it('deduplicates HTTP and realtime copies and keeps the room sequence order', () => {
    expect(
      mergeChatMessages(
        [message('one', 1), message('three', 3)],
        [message('three', 3), message('two', 2)],
      ),
    ).toEqual([message('one', 1), message('two', 2), message('three', 3)])
  })

  it('finds the first missing room sequence without treating a history prefix as a gap', () => {
    expect(firstChatSequenceGap([message('five', 5), message('six', 6)])).toBeNull()
    expect(
      firstChatSequenceGap([
        message('five', 5),
        message('seven', 7),
        message('nine', 9),
      ]),
    ).toBe(5)
  })
})
