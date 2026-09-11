// @vitest-environment node

import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  chatControlChannel,
  chatTranscriptChannel,
  createChatConnectionToken,
  disconnectChatParticipant,
} from '@/lib/chat-realtime'

function decodeBase64Url(value: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >
}

describe('Chat realtime credentials', () => {
  it('issues an HS256 token for the exact server-side subscriptions for five minutes', () => {
    const secret = 'test-centrifugo-token-secret-at-least-32-characters'
    const token = createChatConnectionToken({
      accountId: 'participant-id',
      channelId: 'stable-channel-id',
      now: new Date('2026-09-11T10:00:00.000Z'),
      secret,
    })
    const [encodedHeader, encodedPayload, signature] = token.split('.')

    expect(decodeBase64Url(encodedHeader)).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(decodeBase64Url(encodedPayload)).toEqual({
      aud: 'frankerzspam-chat',
      channels: [
        chatTranscriptChannel('stable-channel-id'),
        chatControlChannel('participant-id'),
      ],
      exp: 1_789_121_100,
      iat: 1_789_120_800,
      iss: 'frankerzspam-viewer',
      sub: 'participant-id',
    })
    expect(signature).toBe(
      createHmac('sha256', secret)
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest('base64url'),
    )
  })

  it('disconnects every connection for a disabled account without reconnect', async () => {
    process.env.CHAT_ENABLED = 'true'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ result: {} }),
    )

    await disconnectChatParticipant('disabled-account-id', fetcher)

    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:8000/api/disconnect',
    )
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      user: 'disabled-account-id',
      disconnect: { code: 3500, reason: 'account disabled' },
    })
    delete process.env.CHAT_ENABLED
  })
})
