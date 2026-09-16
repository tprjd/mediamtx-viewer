import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChatMessage } from '@/components/chat-message'

describe('Chat message rendering rules', () => {
  it('keeps timestamps hidden until the participant enables them', () => {
    render(
      <ChatMessage
        message={{
          id: 'timestamp-message',
          sequence: 1,
          content: 'Hello',
          profileName: 'Friend',
          authorTag: 'a1b2',
          badges: [],
          serverTimestamp: '2026-09-11T09:00:00.000Z',
        }}
      />,
    )

    expect(screen.queryByLabelText(/^Sent /)).toBeNull()
  })

  it('renders a URL as plain text without creating a link', () => {
    render(
      <div>
        <ChatMessage
          message={{
            id: 'message-id',
            sequence: 1,
            content: 'read https://example.test',
            profileName: 'Friend',
            authorTag: 'a1b2',
            badges: [],
            serverTimestamp: '2026-09-11T09:00:00.000Z',
          }}
        />
      </div>,
    )

    expect(screen.getByText('read https://example.test')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
