import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { ChatSettings, useChatTimestamps } from '@/components/chat-settings'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  fireEvent(window, new StorageEvent('storage', { key: null }))
  cleanup()
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

it('saves the message text size and restores the selected choice', async () => {
  const view = render(<Settings />)
  fireEvent.keyDown(screen.getByRole('button', { name: 'Chat settings' }), { key: 'Enter' })
  expect(await screen.findByRole('menuitemradio', { name: 'Default' })).toBeChecked()
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Large' }))
  expect(screen.getByRole('menuitemradio', { name: 'Large' })).toBeChecked()
  expect(localStorage.getItem('home-stream.chat-text-size')).toBe('large')
  view.unmount()
  render(<Settings />)
  fireEvent.keyDown(screen.getByRole('button', { name: 'Chat settings' }), { key: 'Enter' })
  expect(await screen.findByRole('menuitemradio', { name: 'Large' })).toBeChecked()
})

it('uses the default for invalid stored sizes and accepts changes from another tab', async () => {
  localStorage.setItem('home-stream.chat-text-size', 'huge')
  render(<Settings />)
  fireEvent.keyDown(screen.getByRole('button', { name: 'Chat settings' }), { key: 'Enter' })
  expect(await screen.findByRole('menuitemradio', { name: 'Default' })).toBeChecked()
  localStorage.setItem('home-stream.chat-text-size', 'small')
  fireEvent(window, new StorageEvent('storage', { key: 'home-stream.chat-text-size' }))
  expect(screen.getByRole('menuitemradio', { name: 'Small' })).toBeChecked()
})

it.each(['getItem', 'setItem'] as const)('keeps text size usable when storage %s fails', async (method) => {
  vi.spyOn(Storage.prototype, method).mockImplementation(() => {
    throw new DOMException('Storage unavailable', 'SecurityError')
  })
  render(<Settings />)
  fireEvent.keyDown(screen.getByRole('button', { name: 'Chat settings' }), { key: 'Enter' })
  expect(await screen.findByRole('menuitemradio', { name: 'Default' })).toBeChecked()
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Large' }))
  expect(screen.getByRole('menuitemradio', { name: 'Large' })).toBeChecked()
})
