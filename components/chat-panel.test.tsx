import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PublicChatMessage, PublicChatMessageEvent } from '@/lib/chat-types'

const realtime = vi.hoisted(() => ({
  instances: [] as Array<{
    connect: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    emit: (event: string, value: unknown) => void
    refreshToken: () => Promise<string>
  }>,
}))

vi.mock('centrifuge', () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  Centrifuge: class FakeCentrifuge {
    private handlers = new Map<string, Array<(value: unknown) => void>>()
    private getToken: () => Promise<string>
    connect = vi.fn(() => {
      void this.getToken()
    })
    disconnect = vi.fn(() => undefined)

    constructor(
      _endpoint: string,
      options: { getToken: () => Promise<string> },
    ) {
      this.getToken = options.getToken
      realtime.instances.push(this)
    }

    on(event: string, callback: (value: unknown) => void): this {
      const callbacks = this.handlers.get(event) ?? []
      callbacks.push(callback)
      this.handlers.set(event, callbacks)
      return this
    }

    emit(event: string, value: unknown): void {
      for (const callback of this.handlers.get(event) ?? []) callback(value)
    }

    refreshToken(): Promise<string> {
      return this.getToken()
    }
  },
}))

import { ChatPanel } from '@/components/chat-panel'

function message(id: string, sequence: number): PublicChatMessage {
  return {
    id,
    sequence,
    content: `message ${sequence}`,
    profileName: 'Participant',
    authorTag: 'a1b2',
    badges: [],
    serverTimestamp: '2026-09-11T10:00:00.000Z',
  }
}

function publication(value: PublicChatMessage): PublicChatMessageEvent {
  return { type: 'message', eventId: `event-${value.id}`, message: value }
}

beforeEach(() => {
  realtime.instances.length = 0
  vi.unstubAllGlobals()
})

afterEach(cleanup)

describe('live Chat delivery', () => {
  it('gets a new token when Centrifuge requests a token refresh', async () => {
    let tokenNumber = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/token')) {
          tokenNumber += 1
          return Response.json({ token: `token-${tokenNumber}` })
        }
        return Response.json({ messages: [] })
      }),
    )

    render(
      <ChatPanel
        channelSlug="live"
        narrowLayout={false}
        onClose={() => undefined}
      />,
    )
    await waitFor(() => expect(tokenNumber).toBe(1))

    await expect(realtime.instances[0].refreshToken()).resolves.toBe('token-2')
  })

  it('replaces the transcript and connection when the visible Channel changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/token')) return Response.json({ token: 'token' })
        if (url.includes('/first/chat/messages')) {
          return Response.json({
            messages: [
              { ...message('first', 1), content: 'first Channel message' },
            ],
          })
        }
        return Response.json({
          messages: [
            { ...message('second', 1), content: 'second Channel message' },
          ],
        })
      }),
    )
    const view = render(
      <ChatPanel
        channelSlug="first"
        narrowLayout={false}
        onClose={() => undefined}
      />,
    )
    await screen.findByText('first Channel message')

    view.rerender(
      <ChatPanel
        channelSlug="second"
        narrowLayout={false}
        onClose={() => undefined}
      />,
    )

    await waitFor(() => {
      expect(realtime.instances).toHaveLength(2)
      expect(realtime.instances[0].disconnect).toHaveBeenCalledOnce()
    })
    await screen.findByText('second Channel message')
    expect(screen.queryByText('first Channel message')).toBeNull()
  })

  it('merges a publication once and repairs a room-sequence gap from SQLite', async () => {
    const requests: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        requests.push(url)
        if (url.endsWith('/token')) return Response.json({ token: 'token' })
        if (url.endsWith('?after=1')) {
          return Response.json({
            messages: [message('two', 2), message('three', 3)],
            hasMore: false,
          })
        }
        return Response.json({ messages: [message('one', 1)] })
      }),
    )

    render(
      <ChatPanel
        channelSlug="live"
        narrowLayout={false}
        onClose={() => undefined}
      />,
    )
    await screen.findByText('message 1')
    const client = realtime.instances[0]
    client.emit('publication', {
      channel: 'chat:stable-channel-id',
      data: publication(message('three', 3)),
    })

    await screen.findByText('message 2')
    expect(requests).toContain('/api/channels/live/chat/messages?after=1')
    expect(
      within(screen.getByRole('log'))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining('message 1'),
      expect.stringContaining('message 2'),
      expect.stringContaining('message 3'),
    ])

    client.emit('publication', {
      channel: 'chat:stable-channel-id',
      data: publication(message('three', 3)),
    })
    expect(screen.getAllByText('message 3')).toHaveLength(1)
  })

  it('disconnects when a narrow Chat is collapsed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/token')
          ? Response.json({ token: 'token' })
          : Response.json({ messages: [] }),
      ),
    )
    const view = render(
      <ChatPanel
        channelSlug="live"
        narrowLayout={false}
        onClose={() => undefined}
      />,
    )
    await waitFor(() => expect(realtime.instances).toHaveLength(1))

    view.rerender(
      <ChatPanel
        channelSlug="live"
        narrowLayout
        onClose={() => undefined}
      />,
    )

    await waitFor(() => {
      expect(realtime.instances[0].disconnect).toHaveBeenCalledOnce()
    })
  })
})
