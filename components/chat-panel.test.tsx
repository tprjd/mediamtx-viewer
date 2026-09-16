import { webcrypto } from 'node:crypto'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import {
  useState,
  type ComponentType,
  type ReactNode,
  type UIEvent,
} from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  PublicChatMessage,
  PublicChatMessageEvent,
} from '@/lib/chat-types'

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
    setToken = vi.fn(() => undefined)

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

vi.mock('react-virtuoso', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-virtuoso')>()
  const React = await import('react')

  return {
    ...original,
    Virtuoso: React.forwardRef(function FakeVirtuoso(
      props: Record<string, unknown>,
      ref,
    ) {
      const data = (props.data ?? []) as unknown[]
      const itemContent = props.itemContent as (
        index: number,
        value: unknown,
      ) => ReactNode
      const components = props.components as {
        EmptyPlaceholder?: ComponentType
        Header?: ComponentType<{ context: unknown }>
      }
      const atBottomStateChange = props.atBottomStateChange as (
        atBottom: boolean,
      ) => void
      const startReached = props.startReached as (() => void) | undefined
      const [atBottom, setAtBottom] = React.useState(true)
      const visibleStart = atBottom ? Math.max(0, data.length - 8) : 0
      const visibleData = data.slice(visibleStart, visibleStart + 8)

      React.useImperativeHandle(ref, () => ({
        scrollToIndex() {
          setAtBottom(true)
          atBottomStateChange(true)
        },
      }))

      return React.createElement(
        'div',
        {
          'aria-busy': props['aria-busy'],
          'aria-label': props['aria-label'],
          'aria-live': props['aria-live'],
          className: props.className,
          'data-at-bottom': props['data-at-bottom'],
          'data-realtime-state': props['data-realtime-state'],
          onScroll(event: UIEvent<HTMLDivElement>) {
            const nextAtBottom = event.currentTarget.scrollTop > 0
            setAtBottom(nextAtBottom)
            atBottomStateChange(nextAtBottom)
            if (!nextAtBottom) startReached?.()
          },
          role: props.role,
        },
        components.Header
          ? React.createElement(components.Header, { context: props.context })
          : null,
        data.length === 0 && components.EmptyPlaceholder
          ? React.createElement(components.EmptyPlaceholder)
          : visibleData.map((entry, offset) =>
              React.createElement(
                React.Fragment,
                { key: visibleStart + offset },
                itemContent(visibleStart + offset, entry),
              ),
            ),
      )
    }),
  }
})

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

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function ChatReopenHarness() {
  const [open, setOpen] = useState(true)
  return open ? (
    <ChatPanel
      channelSlug="live"
      narrowLayout={false}
      onClose={() => setOpen(false)}
    />
  ) : (
    <button onClick={() => setOpen(true)} type="button">
      Open Chat
    </button>
  )
}

function stubChatFetch(fetcher: typeof fetch) {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/state'))
      return Promise.resolve(
        Response.json({
          channelId: 'live-channel',
          restriction: null,
          moderatorRole: null,
          serverTime: new Date().toISOString(),
        }),
      )
    return fetcher(input, init)
  })
}

beforeEach(() => {
  realtime.instances.length = 0
  vi.unstubAllGlobals()
  vi.stubGlobal('crypto', webcrypto)
})

afterEach(cleanup)

describe('live Chat delivery', () => {
  it('gets a new token when Centrifuge requests a token refresh', async () => {
    let tokenNumber = 0
    stubChatFetch(
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
    stubChatFetch(
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
    stubChatFetch(
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
        .filter((item) => item.hasAttribute('data-message-entry-id'))
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining('message 1'),
      expect.stringContaining('message 2'),
      expect.stringContaining('message 3'),
    ])
    expect(
      screen.getByText('This is the start of the last seven days.'),
    ).toBeVisible()

    client.emit('publication', {
      channel: 'chat:stable-channel-id',
      data: publication(message('three', 3)),
    })
    expect(screen.getAllByText('message 3')).toHaveLength(1)
  })

  it('disconnects when a narrow Chat is collapsed', async () => {
    stubChatFetch(
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
      <ChatPanel channelSlug="live" narrowLayout onClose={() => undefined} />,
    )

    await waitFor(() => {
      expect(realtime.instances[0].disconnect).toHaveBeenCalledOnce()
    })
  })

  it('loads retained pages upward and keeps the rendered transcript bounded', async () => {
    const requests: string[] = []
    const retained = (sequence: number): PublicChatMessage => ({
      ...message(`retained-${sequence}`, sequence),
      serverTimestamp: '2026-09-11T09:00:00.000Z',
    })
    const latest = Array.from({ length: 100 }, (_, index) =>
      retained(index + 101),
    )
    const older = Array.from({ length: 100 }, (_, index) => retained(index + 1))
    const pages = new Map([
      [
        '/api/channels/live/chat/messages',
        { messages: latest, hasMore: true, cursor: 'cursor-101' },
      ],
      [
        '/api/channels/live/chat/messages?before=cursor-101',
        { messages: older, hasMore: false, cursor: null },
      ],
    ])
    stubChatFetch(
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input).replace('http://localhost', '')
        requests.push(url)
        if (url.endsWith('/token')) return Response.json({ token: 'token' })
        const body = pages.get(url)
        if (!body) throw new Error(`Unexpected request: ${url}`)
        return Response.json(body)
      }),
    )

    render(
      <ChatPanel
        channelSlug="live"
        narrowLayout={false}
        onClose={() => undefined}
      />,
    )
    await screen.findByRole('log')
    await screen.findByText('message 200')
    const log = screen.getByRole('log')
    await waitFor(() => expect(log).toHaveAttribute('data-at-bottom', 'true'))
    expect(requests.filter((url) => url.includes('before='))).toHaveLength(0)
    await nextAnimationFrame()

    fireEvent.scroll(log, { target: { scrollTop: 0 } })

    await waitFor(() => {
      expect(requests.filter((url) => url.includes('before='))).toHaveLength(1)
    })
    await waitFor(() =>
      expect(
        screen.getByText('This is the start of the last seven days.'),
      ).toBeVisible(),
    )
    expect(within(log).getAllByRole('listitem').length).toBeLessThan(30)
  })

  it('does not show the retention boundary after the initial history load fails', async () => {
    stubChatFetch(
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/token')
          ? Response.json({ token: 'token' })
          : Response.json({ error: 'temporary failure' }, { status: 503 }),
      ),
    )

    render(
      <ChatPanel
        channelSlug="live"
        narrowLayout={false}
        onClose={() => undefined}
      />,
    )

    await screen.findByText('temporary failure')
    expect(
      screen.queryByText('This is the start of the last seven days.'),
    ).toBeNull()
  })

  it('announces a realtime message only while live at the bottom', async () => {
    const initial = Array.from({ length: 20 }, (_, index) =>
      message(`initial-${index + 1}`, index + 1),
    )
    stubChatFetch(
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/token')
          ? Response.json({ token: 'token' })
          : Response.json({ messages: initial, hasMore: false, cursor: null }),
      ),
    )
    render(
      <ChatPanel
        channelSlug="live"
        narrowLayout={false}
        onClose={() => undefined}
      />,
    )
    await screen.findByRole('log')
    await screen.findByText('message 20')
    const log = screen.getByRole('log')
    const getStatus = () => screen.getByRole('status')
    expect(getStatus()).toBeEmptyDOMElement()
    expect(getStatus()).toHaveAttribute('aria-live', 'polite')

    realtime.instances[0].emit('publication', {
      channel: 'chat:stable-channel-id',
      data: publication(message('twenty-one', 21)),
    })
    await waitFor(() => {
      expect(getStatus()).toHaveTextContent('Participant: message 21')
    })
    await nextAnimationFrame()

    fireEvent.scroll(log, { target: { scrollTop: 0 } })
    await waitFor(() => expect(log).toHaveAttribute('data-at-bottom', 'false'))
    await waitFor(() => expect(getStatus()).toHaveAttribute('aria-live', 'off'))
    expect(getStatus()).toBeEmptyDOMElement()
    realtime.instances[0].emit('publication', {
      channel: 'chat:stable-channel-id',
      data: publication(message('twenty-two', 22)),
    })
    expect(getStatus()).toBeEmptyDOMElement()

    screen.getByRole('button', { name: 'New messages' }).click()
    await waitFor(() => expect(log).toHaveAttribute('data-at-bottom', 'true'))
    realtime.instances[0].emit('publication', {
      channel: 'chat:stable-channel-id',
      data: publication(message('twenty-three', 23)),
    })
    await waitFor(() => {
      expect(getStatus()).toHaveTextContent('Participant: message 23')
    })
  })

  it('shows local day separators and keeps exact server timestamps accessible', async () => {
    stubChatFetch(
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/token')
          ? Response.json({ token: 'token' })
          : Response.json({
              messages: [
                {
                  ...message('day-one', 1),
                  serverTimestamp: '2026-09-10T10:00:00.000Z',
                },
                {
                  ...message('day-two', 2),
                  serverTimestamp: '2026-09-11T10:00:00.000Z',
                },
              ],
              hasMore: false,
              cursor: null,
            }),
      ),
    )

    render(
      <ChatPanel
        channelSlug="live"
        narrowLayout={false}
        onClose={() => undefined}
      />,
    )

    await screen.findByLabelText('Sent 2026-09-11T10:00:00.000Z')
    const log = screen.getByRole('log', { name: 'Chat messages' })
    await waitFor(() => {
      expect(within(log).getAllByRole('separator')).toHaveLength(2)
    })
    expect(
      within(log).getByLabelText('Sent 2026-09-11T10:00:00.000Z'),
    ).toBeVisible()
    expect(log).toHaveAttribute('aria-live', 'off')
  })

  it('fetches current history and starts at the bottom after Chat reopens', async () => {
    let historyRequest = 0
    stubChatFetch(
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/token')) {
          return Response.json({ token: 'token' })
        }
        historyRequest += 1
        const sequence = historyRequest === 1 ? 1 : 2
        return Response.json({
          messages: [message(`history-${sequence}`, sequence)],
          hasMore: false,
          cursor: null,
        })
      }),
    )

    render(<ChatReopenHarness />)
    await screen.findByText('message 1')
    screen.getByRole('button', { name: 'Close Chat' }).click()
    const openButton = await screen.findByRole('button', { name: 'Open Chat' })
    openButton.click()

    await screen.findByText('message 2')
    expect(historyRequest).toBe(2)
    expect(screen.getByRole('log')).toHaveAttribute('data-at-bottom', 'true')
    expect(screen.queryByRole('button', { name: 'New messages' })).toBeNull()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})

describe('Chat sending', () => {
  it('shows the pending text immediately and retries a failed request with the same key', async () => {
    const bodies: string[] = []
    let resolveSend: (response: Response) => void = () => undefined
    stubChatFetch(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/token'))
          return Response.json({ token: 'token' })
        if (init?.method === 'POST') {
          bodies.push(String(init.body))
          return new Promise<Response>((resolve) => {
            resolveSend = resolve
          })
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
    const input = screen.getByRole('textbox', { name: 'Chat message' })
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.change(input, { target: { value: 'keep my submission' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('log')).toHaveTextContent('keep my submission')
    expect(screen.getByRole('log')).toHaveTextContent('Sending')
    await waitFor(() => expect(bodies).toHaveLength(1))
    resolveSend(Response.json({ error: 'Request failed.' }, { status: 502 }))
    const retry = await screen.findByRole('button', { name: 'Retry' })
    expect(input).toHaveValue('keep my submission')
    fireEvent.click(retry)
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(JSON.parse(bodies[0]).clientIdempotencyKey).toBeTruthy()
    expect(bodies[1]).toBe(bodies[0])
    resolveSend(
      Response.json(
        {
          message: { ...message('accepted', 1), content: 'keep my submission' },
        },
        { status: 201 },
      ),
    )
    await waitFor(() => expect(input).toHaveValue(''))
    expect(
      within(screen.getByRole('log')).getAllByText('keep my submission'),
    ).toHaveLength(1)
  })
})

it('keeps loaded messages and disables the composer when the Chat database fails', async () => {
  stubChatFetch(
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/token'))
        return Response.json({ token: 'token' })
      if (init?.method === 'POST')
        return Response.json({ error: 'Chat is unavailable.' }, { status: 503 })
      return Response.json({ messages: [message('loaded', 1)] })
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
  const input = screen.getByRole('textbox', { name: 'Chat message' })
  fireEvent.change(input, { target: { value: 'keep during outage' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(input).toBeDisabled())
  expect(screen.getByRole('log')).toHaveTextContent('message 1')
  expect(input).toHaveValue('keep during outage')
  expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
})

it('keeps a draft across closing and opening but clears it on a Channel change', async () => {
  stubChatFetch(
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
  const input = screen.getByRole('textbox', { name: 'Chat message' })
  await waitFor(() => expect(input).toBeEnabled())
  expect(input).not.toHaveFocus()
  fireEvent.change(input, { target: { value: 'in memory' } })
  view.rerender(
    <ChatPanel
      channelSlug="live"
      open={false}
      narrowLayout={false}
      onClose={() => undefined}
    />,
  )
  view.rerender(
    <ChatPanel
      channelSlug="live"
      focusComposer
      narrowLayout={false}
      onClose={() => undefined}
    />,
  )
  await waitFor(() => expect(input).toHaveFocus())
  expect(input).toHaveValue('in memory')
  view.rerender(
    <ChatPanel
      channelSlug="other"
      narrowLayout={false}
      onClose={() => undefined}
    />,
  )
  expect(screen.getByRole('textbox', { name: 'Chat message' })).toHaveValue('')
})

it('keeps a connected durable send successful while its publication is pending', async () => {
  stubChatFetch(
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/token'))
        return Response.json({ token: 'token' })
      if (init?.method === 'POST')
        return Response.json(
          { message: message('accepted', 1) },
          { status: 201 },
        )
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
  const input = screen.getByRole('textbox', { name: 'Chat message' })
  await waitFor(() => expect(input).toBeEnabled())
  await waitFor(() => realtime.instances[0].emit('connected', {}))
  fireEvent.change(input, { target: { value: 'hello' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(input).toHaveValue(''))
  expect(screen.queryByText('Delayed', { exact: true })).toBeNull()
  expect(screen.queryByText(/Reconnecting/)).toBeNull()
})

it('clears original author and content from the live region when SQLite repairs a removal', async () => {
  const original = message('removed-after-outage', 1)
  const removed: PublicChatMessage = {
    id: original.id,
    sequence: 1,
    revisionSequence: 2,
    serverTimestamp: original.serverTimestamp,
    removed: true,
  }
  let repair = false
  stubChatFetch(
    vi.fn(async (url) => {
      if (String(url).endsWith('/token'))
        return Response.json({ token: 'token' })
      return Response.json({
        messages: repair ? [removed] : [],
        hasMore: false,
        cursor: null,
      })
    }),
  )
  render(
    <ChatPanel
      channelSlug="live"
      narrowLayout={false}
      onClose={() => undefined}
    />,
  )
  await waitFor(() =>
    expect(screen.queryByText('Loading Chat...')).not.toBeInTheDocument(),
  )
  realtime.instances[0].emit('publication', {
    channel: 'chat:channel-id',
    data: publication(original),
  })
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Participant: message 1',
    ),
  )
  repair = true
  realtime.instances[0].emit('subscribed', {
    channel: 'chat:channel-id',
    wasRecovering: true,
    recovered: false,
  })
  await waitFor(() =>
    expect(screen.getByText('Message removed')).toBeInTheDocument(),
  )
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
  expect(screen.queryByText('message 1')).not.toBeInTheDocument()
})

it('keeps loaded messages during successful recovery and failed restore reload, then replaces them when a restore succeeds', async () => {
  let restored = false
  let available = true
  let historyRequests = 0
  stubChatFetch(
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/token'))
        return Response.json({ token: 'token' })
      historyRequests++
      if (!available)
        return Response.json({ error: 'Chat is unavailable.' }, { status: 503 })
      return Response.json({
        messages: [message(restored ? 'restored' : 'later', restored ? 1 : 9)],
      })
    }),
  )
  render(
    <ChatPanel
      channelSlug="live"
      narrowLayout={false}
      onClose={() => undefined}
    />,
  )
  await screen.findByText('message 9')
  const client = realtime.instances[0]
  client.emit('connected', {})
  client.emit('connecting', { code: 1 })
  client.emit('connected', {})
  client.emit('subscribed', {
    channel: 'chat:room',
    wasRecovering: true,
    recovered: true,
  })
  expect(historyRequests).toBe(1)
  available = false
  client.emit('connecting', { code: 4001 })
  client.emit('connected', {})
  await screen.findAllByText('Chat is unavailable.')
  expect(screen.getByText('message 9')).toBeVisible()
  available = true
  restored = true
  client.emit('connecting', { code: 4001 })
  client.emit('connected', {})
  await screen.findByText('message 1')
  expect(screen.queryByText('message 9')).toBeNull()
})

it('detects an independent restore after a connection misses the restore disconnect event', async () => {
  let restored = false
  stubChatFetch(
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/token')) return Response.json({ token: 'token' })
      return Response.json({
        restoreGeneration: restored ? 'restored' : 'initial',
        messages: url.includes('?after=')
          ? []
          : [message(restored ? 'restored' : 'later', restored ? 1 : 9)],
        hasMore: false,
      })
    }),
  )
  render(
    <ChatPanel
      channelSlug="live"
      narrowLayout={false}
      onClose={() => undefined}
    />,
  )
  await screen.findByText('message 9')
  restored = true
  realtime.instances[0].emit('subscribed', {
    channel: 'chat:room',
    wasRecovering: true,
    recovered: false,
  })
  await screen.findByText('message 1')
  expect(screen.queryByText('message 9')).toBeNull()
})
