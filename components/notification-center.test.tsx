import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AccountNotification } from '@/lib/viewing-requests'
import { NotificationCenter } from './notification-center'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/account/channel/viewing-actions', () => ({ decideViewingAction: vi.fn(), readNotificationsAction: vi.fn() }))
const tone = vi.fn()
const item = (id: number): AccountNotification => ({ id, title: `Notification ${id}`, body: 'Stored update', readAt: null, requestId: null, revision: null, actionable: false, createdAt: id })
let inbox: { notifications: AccountNotification[]; unread: number; sound: boolean }
beforeEach(() => {
  vi.useFakeTimers()
  tone.mockClear()
  localStorage.clear()
  inbox = { notifications: [item(1)], unread: 1, sound: true }
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(inbox)))
  vi.stubGlobal('AudioContext', class {
    state = 'running'; currentTime = 0; destination = {}
    resume = async () => {}; close = async () => {}
    createOscillator() { tone(); return { frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(() => ({ connect: vi.fn() })), start: vi.fn(), stop: vi.fn() } }
    createGain() { return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } } }
  })
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, callback: () => void) => callback() } })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
const poll = () => act(async () => { await vi.advanceTimersByTimeAsync(5000) })
it('sounds only for new notifications, preserves muted delivery, and keeps a reconnect backlog silent', async () => {
  render(<NotificationCenter userId="viewer" initial={inbox} />)
  fireEvent.pointerDown(window)
  await poll()
  expect(tone).not.toHaveBeenCalled()
  inbox = { ...inbox, notifications: [item(2), item(1)], unread: 2 }
  await poll()
  expect(tone).toHaveBeenCalledTimes(1)
  inbox = { notifications: [item(3)], unread: 3, sound: false }
  await poll()
  expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument()
  expect(tone).toHaveBeenCalledTimes(1)
  vi.mocked(fetch).mockRejectedValueOnce(new Error('Offline'))
  await poll()
  inbox = { notifications: [item(4)], unread: 4, sound: true }
  await poll()
  expect(tone).toHaveBeenCalledTimes(1)
})
it('keeps displaced stored notifications when the latest page fills', async () => {
  const initial = { notifications: Array.from({ length: 99 }, (_, index) => item(99 - index)), unread: 99, sound: false }
  render(<NotificationCenter userId="viewer" initial={initial} />)
  inbox = { notifications: Array.from({ length: 100 }, (_, index) => item(101 - index)), unread: 101, sound: false }
  await poll()
  fireEvent.click(screen.getByRole('button', { name: 'Notifications, 101 unread' }))
  expect(screen.getByRole('heading', { name: 'Notification 1' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Notification 101' })).toBeInTheDocument()
})
