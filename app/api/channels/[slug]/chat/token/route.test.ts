// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorizeLiveChat: vi.fn(),
  createChatConnectionToken: vi.fn(),
}))

vi.mock('@/lib/chat-access', () => ({
  authorizeLiveChat: mocks.authorizeLiveChat,
}))
vi.mock('@/lib/chat-realtime', () => ({
  createChatConnectionToken: mocks.createChatConnectionToken,
}))

import { GET } from '@/app/api/channels/[slug]/chat/token/route'

const context = { params: Promise.resolve({ slug: 'live' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorizeLiveChat.mockResolvedValue({
    ok: true,
    accountId: 'participant-id',
    profileName: 'Participant',
    channel: {
      id: 'stable-channel-id',
      ownerUserId: 'owner-id',
      mediaPath: 'live',
    },
  })
  mocks.createChatConnectionToken.mockReturnValue('connection-token')
})

describe('/api/channels/[slug]/chat/token', () => {
  it('returns a private connection token for an active participant in a live Channel', async () => {
    const response = await GET(new Request('https://example.test'), context)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    expect(await response.json()).toEqual({ token: 'connection-token' })
    expect(mocks.createChatConnectionToken).toHaveBeenCalledWith({
      accountId: 'participant-id',
      channelId: 'stable-channel-id',
    })
  })

  it('passes through an account or Channel access rejection', async () => {
    mocks.authorizeLiveChat.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'An active account is required.',
    })

    const response = await GET(new Request('https://example.test'), context)

    expect(response.status).toBe(401)
    expect(mocks.createChatConnectionToken).not.toHaveBeenCalled()
  })
})
