import { describe, expect, it } from 'vitest'

import {
  ChatMessageValidationError,
  decideChatSendRate,
  allocateChatAuthorTag,
  normalizeChatMessage,
} from '@/lib/chat-rules'

describe('normalizeChatMessage', () => {
  it('normalizes Unicode, trims outside whitespace, and replaces line breaks', () => {
    expect(normalizeChatMessage('  Cafe\u0301\r\n  hello\nworld  ')).toBe(
      'Café   hello world',
    )
  })

  it('accepts 500 grapheme clusters and rejects 501', () => {
    const combinedCharacter = 'e\u0301'

    expect(normalizeChatMessage(combinedCharacter.repeat(500))).toBe(
      'é'.repeat(500),
    )
    expect(() => normalizeChatMessage(combinedCharacter.repeat(501))).toThrow(
      ChatMessageValidationError,
    )
  })

  it('rejects empty and control-only content', () => {
    expect(() => normalizeChatMessage(' \r\n\t ')).toThrow('Enter a message.')
    expect(() => normalizeChatMessage('\u0000\u0007\u200b')).toThrow(
      'Enter a message.',
    )
  })
})

describe('allocateChatAuthorTag', () => {
  it('extends a new participant tag until it is unique in the Chat room', () => {
    expect(allocateChatAuthorTag('abcd5678', new Set())).toBe('abcd')
    expect(allocateChatAuthorTag('abcd5678', new Set(['abcd']))).toBe('abcd5')
    expect(
      allocateChatAuthorTag('abcd5678', new Set(['abcd', 'abcd5', 'abcd56'])),
    ).toBe('abcd567')
  })
})

describe('Chat sending limits', () => {
  it('allows three immediate sends, then refills one slot every two seconds', () => {
    expect(decideChatSendRate(10_000, 0, [])).toEqual({
      allowed: true,
      nextSendTime: 12_000,
    })
    expect(decideChatSendRate(10_000, 12_000, [10_000])).toEqual({
      allowed: true,
      nextSendTime: 14_000,
    })
    expect(decideChatSendRate(10_000, 14_000, [10_000, 10_000])).toEqual({
      allowed: true,
      nextSendTime: 16_000,
    })
    expect(
      decideChatSendRate(11_999, 16_000, [10_000, 10_000, 10_000]),
    ).toEqual({ allowed: false, retryAt: 12_000 })
    expect(
      decideChatSendRate(12_000, 16_000, [10_000, 10_000, 10_000]),
    ).toEqual({ allowed: true, nextSendTime: 18_000 })
  })

  it('never accepts more than five in a rolling ten seconds, including the initial burst', () => {
    const recent = [10_000, 10_000, 10_000, 12_000, 14_000]
    expect(decideChatSendRate(16_000, 20_000, recent)).toEqual({
      allowed: false,
      retryAt: 20_000,
    })
    expect(decideChatSendRate(19_999, 20_000, recent)).toEqual({
      allowed: false,
      retryAt: 20_000,
    })
    expect(decideChatSendRate(20_000, 20_000, recent)).toEqual({
      allowed: true,
      nextSendTime: 22_000,
    })
  })
})
