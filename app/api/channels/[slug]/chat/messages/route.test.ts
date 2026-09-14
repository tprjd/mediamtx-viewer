// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  getChatChannel: vi.fn(),
  getChannelStatus: vi.fn(),
  getUserById: vi.fn(),
  loadOlderChatMessages: vi.fn(),
  loadLatestChatHistory: vi.fn(),
  requestChatOutboxDispatch: vi.fn(),
  sendChatMessage: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/auth/session', () => ({
  getActiveSession: mocks.getActiveSession,
}))
vi.mock('@/lib/auth/store', () => ({
  getUserById: mocks.getUserById,
}))
vi.mock('@/lib/channels', () => ({
  getChatChannel: mocks.getChatChannel,
}))
vi.mock('@/lib/mediamtx', () => ({
  getChannelStatus: mocks.getChannelStatus,
}))
vi.mock('@/lib/chat', async () => {
  const { ChatMessageValidationError } = await import('@/lib/chat-rules')
  class InvalidChatHistoryCursorError extends Error {}
  return {
    ChatMessageValidationError,
    InvalidChatHistoryCursorError,
    loadLatestChatHistory: mocks.loadLatestChatHistory,
    loadChatMessagesAfter: vi.fn(),
    loadOlderChatMessages: mocks.loadOlderChatMessages,
    sendChatMessage: mocks.sendChatMessage,
  }
})
vi.mock('@/lib/chat-outbox', () => ({
  requestChatOutboxDispatch: mocks.requestChatOutboxDispatch,
}))

import { GET, POST } from '@/app/api/channels/[slug]/chat/messages/route'

const context = { params: Promise.resolve({ slug: 'live' }) }
const channel = {
  id: 'stable-channel-id',
  ownerUserId: 'owner-id',
  mediaPath: 'live',
}
const message = {
  id: 'message-id',
  sequence: 1,
  content: 'hello',
  profileName: 'Viewer',
  authorTag: 'a1b2',
  badges: [],
  serverTimestamp: '2026-09-11T10:00:00.000Z',
}

function postRequest(content: unknown): Request {
  return new Request('https://example.test/api/channels/live/chat/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  })
}

beforeEach(() => {
  process.env.CHAT_ENABLED = 'true'
  mocks.getActiveSession.mockResolvedValue({ user: { id: 'viewer-id' } })
  mocks.getChatChannel.mockReturnValue(channel)
  mocks.getChannelStatus.mockResolvedValue({ live: true, state: 'live' })
  mocks.getUserById.mockReturnValue({
    id: 'viewer-id',
    name: 'Viewer',
    activationStatus: 'active',
  })
  mocks.loadLatestChatHistory.mockReturnValue({
    messages: [message],
    hasMore: false,
    cursor: null,
  })
  mocks.loadOlderChatMessages.mockReturnValue({
    messages: [],
    hasMore: false,
    cursor: null,
  })
  mocks.sendChatMessage.mockReturnValue(message)
})

afterEach(() => {
  delete process.env.CHAT_ENABLED
  vi.clearAllMocks()
})

describe('/api/channels/[slug]/chat/messages', () => {
  it('does no Chat work while the global flag is disabled', async () => {
    process.env.CHAT_ENABLED = 'false'

    const response = await GET(new Request('https://example.test'), context)

    expect(response.status).toBe(404)
    expect(mocks.getActiveSession).not.toHaveBeenCalled()
    expect(mocks.getChannelStatus).not.toHaveBeenCalled()
    expect(mocks.loadLatestChatHistory).not.toHaveBeenCalled()
  })

  it('rejects history and sends without an active account', async () => {
    mocks.getActiveSession.mockResolvedValue(null)

    const historyResponse = await GET(new Request('https://example.test'), context)
    const sendResponse = await POST(postRequest('hello'), context)

    expect(historyResponse.status).toBe(401)
    expect(sendResponse.status).toBe(401)
    expect(mocks.loadLatestChatHistory).not.toHaveBeenCalled()
    expect(mocks.sendChatMessage).not.toHaveBeenCalled()
  })

  it('rejects history and sends when the Channel is offline or unavailable', async () => {
    mocks.getChannelStatus
      .mockResolvedValueOnce({ live: false, state: 'offline' })
      .mockResolvedValueOnce({ live: false, state: 'unavailable' })

    const historyResponse = await GET(new Request('https://example.test'), context)
    const sendResponse = await POST(postRequest('hello'), context)

    expect(historyResponse.status).toBe(409)
    expect(sendResponse.status).toBe(409)
    expect(mocks.loadLatestChatHistory).not.toHaveBeenCalled()
    expect(mocks.sendChatMessage).not.toHaveBeenCalled()
  })

  it('returns the latest messages and the committed send result', async () => {
    const historyResponse = await GET(new Request('https://example.test'), context)
    const sendResponse = await POST(postRequest(' hello '), context)

    expect(historyResponse.status).toBe(200)
    expect(await historyResponse.json()).toEqual({
      messages: [message],
      hasMore: false,
      cursor: null,
    })
    expect(mocks.loadLatestChatHistory).toHaveBeenCalledWith(channel)
    expect(sendResponse.status).toBe(201)
    expect(await sendResponse.json()).toEqual({ message })
    expect(mocks.sendChatMessage).toHaveBeenCalledWith({
      channel,
      participant: {
        accountId: 'viewer-id',
        profileName: 'Viewer',
      },
      rawContent: ' hello ',
    })
    expect(mocks.requestChatOutboxDispatch).toHaveBeenCalledOnce()
  })

  it('returns retained history from the cursor and rejects an invalid cursor', async () => {
    const validResponse = await GET(
      new Request(
        'https://example.test?before=chat-history-v1%3A1',
      ),
      context,
    )

    expect(validResponse.status).toBe(200)
    expect(await validResponse.json()).toEqual({
      messages: [],
      hasMore: false,
      cursor: null,
    })
    expect(mocks.loadOlderChatMessages).toHaveBeenCalledWith(
      channel,
      'chat-history-v1:1',
    )

    const { InvalidChatHistoryCursorError } = await import('@/lib/chat')
    mocks.loadOlderChatMessages.mockImplementation(() => {
      throw new InvalidChatHistoryCursorError('Invalid Chat history cursor.')
    })
    const invalidResponse = await GET(new Request('https://example.test?before=bad'), context)

    expect(invalidResponse.status).toBe(400)
    expect(await invalidResponse.json()).toEqual({
      error: 'Invalid Chat history cursor.',
    })

    mocks.loadOlderChatMessages.mockImplementation(() => {
      throw new Error('database failed')
    })
    const unavailableResponse = await GET(
      new Request('https://example.test?before=chat-history-v1%3A1'),
      context,
    )
    expect(unavailableResponse.status).toBe(503)
    expect(await unavailableResponse.json()).toEqual({
      error: 'Chat is unavailable.',
    })
  })

  it('returns a validation error without storing an invalid message', async () => {
    const { ChatMessageValidationError } = await import('@/lib/chat-rules')
    mocks.sendChatMessage.mockImplementation(() => {
      throw new ChatMessageValidationError('Enter a message.')
    })

    const response = await POST(postRequest('   '), context)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Enter a message.' })
  })
})
