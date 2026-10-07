import { cleanup, render, screen } from '@testing-library/react'
import { StrictMode, type ComponentProps, type ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChatTranscript } from './chat-transcript'
import type { ChatContentMessage } from '@/lib/chat-types'

// Observe the indexes delivered to the virtual-list adapter. Browser tests cover
// its measurements and actual reading position; jsdom cannot measure row height.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, firstItemIndex, itemContent }: {
    data: unknown[]
    firstItemIndex: number
    itemContent: (index: number, entry: unknown) => ReactNode
  }) => <div>{data.map((entry, offset) => <div key={offset} data-virtual-index={firstItemIndex + offset}>
    {itemContent(firstItemIndex + offset, entry)}
  </div>)}</div>,
}))

afterEach(cleanup)

function message(sequence: number, day = 2): ChatContentMessage {
  return {
    id: `message-${sequence}`, sequence, content: `Message ${sequence}`,
    profileName: 'Participant', authorTag: 'a1b2', badges: [],
    serverTimestamp: new Date(2026, 8, day, 12).toISOString(),
  }
}

const defaults = {
  atBottom: true, historyExhausted: false, loadingOlderHistory: false,
  onAtBottomChange: vi.fn(), onLoadOlder: vi.fn(), realtimeState: 'connected',
} satisfies Omit<ComponentProps<typeof ChatTranscript>, 'messages'>

function virtualIndex(sequence: number) {
  const row = document.querySelector(`[data-message-entry-id="message-${sequence}"]`)
  expect(row).not.toBeNull()
  return Number(row!.closest('[data-virtual-index]')!.getAttribute('data-virtual-index'))
}

it.each([1, 2])('preserves message indexes when older messages arrive from day %s', day => {
  const view = render(<ChatTranscript {...defaults} messages={[message(3), message(4)]} />)
  const original = [virtualIndex(3), virtualIndex(4)]
  view.rerender(<ChatTranscript {...defaults} messages={[message(1, day), message(2, day), message(3), message(4)]} />)
  expect([virtualIndex(3), virtualIndex(4)]).toEqual(original)
  expect(screen.getAllByRole('separator')).toHaveLength(day === 2 ? 1 : 2)
})

it('counts the final history marker even when the last history page adds no messages', () => {
  const messages = [message(3), message(4)]
  const view = render(<ChatTranscript {...defaults} messages={messages} />)
  const original = virtualIndex(3)
  view.rerender(<ChatTranscript {...defaults} messages={messages} historyExhausted />)
  expect(virtualIndex(3)).toBe(original)
  expect(screen.getByText('This is the start of the last seven days.')).toBeInTheDocument()
})

it('excludes simultaneous live appends and local submissions from the prepend offset', () => {
  const view = render(<ChatTranscript {...defaults} messages={[message(3), message(4)]} />)
  const original = [virtualIndex(3), virtualIndex(4)]
  view.rerender(<ChatTranscript {...defaults} historyExhausted
    messages={[message(1, 1), message(2, 1), message(3), message(4), message(5, 3)]}
    submissions={[{ key: 'pending', content: 'Sending this', state: 'sending' }]} />)
  expect([virtualIndex(3), virtualIndex(4)]).toEqual(original)
  expect(screen.getByText('Sending this')).toBeInTheDocument()
  expect(screen.getAllByRole('separator')).toHaveLength(3)
})

it('keeps indexes through live delivery, retries, message removal, and badge updates', () => {
  const view = render(<ChatTranscript {...defaults} messages={[message(3), message(4)]} />)
  const original = [virtualIndex(3), virtualIndex(4)]
  view.rerender(<ChatTranscript {...defaults} messages={[message(3), message(4), message(5, 3)]}
    submissions={[{ key: 'pending', content: 'Retry this', state: 'failed' }]} />)
  expect([virtualIndex(3), virtualIndex(4)]).toEqual(original)
  view.rerender(<ChatTranscript {...defaults} messages={[
    { id: 'message-3', sequence: 3, revisionSequence: 6, removed: true, serverTimestamp: message(3).serverTimestamp },
    { ...message(4), badges: ['owner'] }, message(5, 3),
  ]} />)
  expect([virtualIndex(3), virtualIndex(4)]).toEqual(original)
  expect(screen.queryByText('Retry this')).not.toBeInTheDocument()
})

it('starts fresh after the room reset signal even when the loaded messages are unchanged', () => {
  const view = render(<StrictMode><ChatTranscript {...defaults} key="visit-1" messages={[message(3)]} /></StrictMode>)
  const initial = virtualIndex(3)
  const messages = [message(1), message(2), message(3)]
  view.rerender(<StrictMode><ChatTranscript {...defaults} key="visit-1" messages={messages} /></StrictMode>)
  expect(virtualIndex(3)).toBe(initial)
  view.rerender(<StrictMode><ChatTranscript {...defaults} key="visit-2" messages={messages} /></StrictMode>)
  expect(virtualIndex(1)).toBe(initial)
  expect(virtualIndex(3)).toBe(initial + 2)
})
