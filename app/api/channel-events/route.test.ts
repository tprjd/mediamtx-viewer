import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  subscribe: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({
  getActiveSession: mocks.getActiveSession,
}))

vi.mock('@/lib/channel-status-monitor', () => ({
  getChannelStatusMonitor: () => ({ subscribe: mocks.subscribe }),
}))

import { GET } from '@/app/api/channel-events/route'

afterEach(() => {
  vi.restoreAllMocks()
  mocks.getActiveSession.mockReset()
  mocks.subscribe.mockReset()
})

describe('GET /api/channel-events', () => {
  it('rejects a request without an active account session', async () => {
    mocks.getActiveSession.mockResolvedValue(null)

    const response = await GET(new Request('https://example.test/api/channel-events'))

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.subscribe).not.toHaveBeenCalled()
  })

  it('streams the initial snapshot as SSE', async () => {
    mocks.getActiveSession.mockResolvedValue({ user: { id: 'viewer' } })
    mocks.subscribe.mockImplementation(async (listener) => {
      listener({
        id: 1,
        type: 'snapshot',
        data: { channels: [], updatedAt: '2026-08-31T10:00:00.000Z' },
      })
      return () => undefined
    })
    const abortController = new AbortController()
    const response = await GET(
      new Request('https://example.test/api/channel-events', {
        signal: abortController.signal,
      }),
    )
    const reader = response.body!.getReader()
    const first = await reader.read()
    const text = new TextDecoder().decode(first.value)

    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('cache-control')).toContain('no-transform')
    expect(text).toContain('id: 1\nevent: snapshot\n')
    expect(text).toContain('"channels":[]')

    abortController.abort()
    await reader.cancel()
  })
})
