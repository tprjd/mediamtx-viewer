import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { ChatSettings, useChatTimestamps } from '@/components/chat-settings'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

function Settings() {
  return <ChatSettings showTimestamps={useChatTimestamps()} />
}

it('keeps the timestamp toggle usable when storage reads work but writes fail', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage is full', 'QuotaExceededError')
  })
  render(<Settings />)
  fireEvent.keyDown(screen.getByRole('button', { name: 'Chat settings' }), {
    key: 'Enter',
  })
  const toggle = await screen.findByRole('menuitemcheckbox', {
    name: /Show timestamps/,
  })
  expect(toggle).not.toBeChecked()
  fireEvent.click(toggle)
  expect(toggle).toBeChecked()
  fireEvent.click(toggle)
  expect(toggle).not.toBeChecked()
})
