import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { decideViewingAction, readNotificationsAction } from '@/app/account/channel/viewing-actions'
import { playNotificationTone } from '@/lib/notification-sound'
import { useNotificationInbox, type NotificationInbox } from './notification-inbox'

const { refreshRoute } = vi.hoisted(() => ({ refreshRoute: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshRoute }) }))
vi.mock('@/app/account/channel/viewing-actions', () => ({ decideViewingAction: vi.fn(), readNotificationsAction: vi.fn() }))
vi.mock('@/lib/notification-sound', () => ({ playNotificationTone: vi.fn() }))
const item = (id: number) => ({ id, title: `Notification ${id}`, body: 'Stored update', readAt: null, createdAt: id, requestId: null, revision: null, actionable: false })
const page = (first: number, length = 100): NotificationInbox => ({ notifications: Array.from({ length }, (_, index) => item(first - index)), unread: first, sound: false })
const poll = () => act(async () => { await vi.advanceTimersByTimeAsync(5000) })
let inbox: NotificationInbox

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.mocked(readNotificationsAction).mockResolvedValue(undefined)
  vi.mocked(decideViewingAction).mockResolvedValue({ success: true })
  inbox = { notifications: [item(1)], unread: 1, sound: true }
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(inbox)))
  vi.stubGlobal('AudioContext', class {
    state = 'running'
    resume = async () => {}
    close = async () => {}
  })
  localStorage.clear()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, callback: () => void) => callback() } })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('keeps current notification fields and counts when history overlaps the latest page', async () => {
  const { result } = renderHook(() => useNotificationInbox('viewer', page(200)))
  inbox = { notifications: [{ ...item(101), readAt: 123 }], unread: 199, sound: true }
  await poll()
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(page(101, 2)))
  await act(() => result.current.loadOlder())
  expect(fetch).toHaveBeenLastCalledWith('/api/notifications?before=101', expect.anything())
  expect(result.current.notifications).toHaveLength(101)
  expect(result.current.notifications.find((notice) => notice.id === 101)?.readAt).toBe(123)
  expect(result.current.notifications.at(-1)?.id).toBe(100)
  expect(result.current.unread).toBe(199)
  expect(result.current.sound).toBe(true)
  expect(result.current.more).toBe(false)
})

it('keeps the new history cursor when an older page arrives after a full replacement page', async () => {
  const history = Promise.withResolvers<Response>()
  const { result } = renderHook(() => useNotificationInbox('viewer', page(100)))
  vi.mocked(fetch).mockReturnValueOnce(history.promise)
  let loading: Promise<void>
  act(() => { loading = result.current.loadOlder() })
  inbox = page(300)
  await poll()
  await act(async () => { history.resolve(Response.json(page(0, 0))); await loading })
  expect(result.current.more).toBe(true)
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(page(200)))
  await act(() => result.current.loadOlder())
  expect(fetch).toHaveBeenLastCalledWith('/api/notifications?before=201', expect.anything())
  expect(result.current.notifications.map((notice) => notice.id)).toEqual(page(300, 300).notifications.map((notice) => notice.id))
})

it('does not let an earlier poll restore actions after a Viewing request decision', async () => {
  inbox = { ...inbox, notifications: [{ ...item(1), requestId: 'request', revision: 2, actionable: true }] }
  const oldPoll = Promise.withResolvers<Response>()
  const { result } = renderHook(() => useNotificationInbox('viewer', inbox))
  vi.mocked(fetch).mockReturnValueOnce(oldPoll.promise)
  await poll()
  inbox = { ...inbox, notifications: [{ ...inbox.notifications[0], actionable: false }] }
  await act(() => result.current.decide('request', 2, 'approved'))
  await act(async () => { oldPoll.resolve(Response.json({ ...inbox, notifications: [{ ...inbox.notifications[0], actionable: true }] })) })
  expect(decideViewingAction).toHaveBeenCalledWith('request', 2, 'approved')
  expect(result.current.notifications[0].actionable).toBe(false)
  expect(result.current.message).toBe('Viewing request approved.')
  expect(refreshRoute).toHaveBeenCalledOnce()
})

it('marks loaded history read and keeps it read when the latest page omits it', async () => {
  const { result } = renderHook(() => useNotificationInbox('viewer', page(200)))
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(page(100)))
  await act(() => result.current.loadOlder())
  inbox = { ...page(200), notifications: page(200).notifications.map((notice) => ({ ...notice, readAt: 123 })), unread: 0 }
  await act(() => result.current.markRead())
  expect(readNotificationsAction).toHaveBeenCalledWith(undefined)
  expect(result.current.notifications).toHaveLength(200)
  expect(result.current.notifications.every((notice) => notice.readAt !== null)).toBe(true)
  expect(result.current.unread).toBe(0)
})

it('allows one action at a time and waits until the write completes before polling again', async () => {
  const write = Promise.withResolvers<void>()
  vi.mocked(readNotificationsAction).mockReturnValueOnce(write.promise)
  const { result } = renderHook(() => useNotificationInbox('viewer', inbox))
  let reading: Promise<void>
  act(() => { reading = result.current.markRead(1); void result.current.markRead(1) })
  await poll()
  expect(fetch).not.toHaveBeenCalled()
  expect(readNotificationsAction).toHaveBeenCalledOnce()
  expect(result.current.busy).toBe(true)
  inbox = { ...inbox, notifications: [{ ...item(1), readAt: 123 }], unread: 0 }
  await act(async () => { write.resolve(); await reading })
  expect(result.current.busy).toBe(false)
  await poll()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('retains notifications after failures and permits retrying each action', async () => {
  const { result } = renderHook(() => useNotificationInbox('viewer', inbox))
  vi.mocked(readNotificationsAction).mockRejectedValueOnce(new Error('Offline'))
  await act(() => result.current.markRead(1))
  expect(result.current.message).toBe('Notifications could not be marked read. Try again.')
  expect(result.current.notifications[0].readAt).toBeNull()
  expect(result.current.busy).toBe(false)
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }))
  await act(() => result.current.loadOlder())
  expect(result.current.message).toBe('Older notifications could not be loaded. Try again.')
  vi.mocked(decideViewingAction).mockRejectedValueOnce(new Error('Offline'))
  await act(() => result.current.decide('request', 2, 'approved'))
  expect(result.current.message).toBe('The request could not be updated. Try again.')
  expect(result.current.busy).toBe(false)
  vi.mocked(decideViewingAction).mockResolvedValueOnce({ error: 'This request has already been decided.' })
  await act(() => result.current.decide('request', 2, 'approved'))
  expect(result.current.message).toBe('This request has already been decided.')
  expect(refreshRoute).toHaveBeenCalledOnce()
})

it('does not overlap polls and aborts the outstanding request on disposal', async () => {
  const pending = Promise.withResolvers<Response>()
  vi.mocked(fetch).mockReturnValueOnce(pending.promise)
  const { unmount } = renderHook(() => useNotificationInbox('viewer', inbox))
  await poll()
  await poll()
  expect(fetch).toHaveBeenCalledOnce()
  const signal = vi.mocked(fetch).mock.calls[0][1]?.signal
  unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => { pending.resolve(Response.json(page(5, 1))) })
  await poll()
  expect(fetch).toHaveBeenCalledOnce()
})

it('does not refresh the route or fetch an inbox after a disposed decision completes', async () => {
  const decision = Promise.withResolvers<Awaited<ReturnType<typeof decideViewingAction>>>()
  vi.mocked(decideViewingAction).mockReturnValueOnce(decision.promise)
  const { result, unmount } = renderHook(() => useNotificationInbox('viewer', inbox))
  let deciding: Promise<void>
  act(() => { deciding = result.current.decide('request', 2, 'approved') })
  unmount()
  await act(async () => { decision.resolve({ success: true }); await deciding })
  expect(fetch).not.toHaveBeenCalled()
  expect(refreshRoute).not.toHaveBeenCalled()
})

it('plays one sound across inboxes for the same account', async () => {
  renderHook(() => useNotificationInbox('viewer', inbox))
  renderHook(() => useNotificationInbox('viewer', inbox))
  fireEvent.pointerDown(window)
  inbox = { ...inbox, notifications: [item(2), item(1)], unread: 2 }
  await poll()
  expect(playNotificationTone).toHaveBeenCalledOnce()
  expect(localStorage.getItem('notification-sound-viewer')).toBe('2')
})

it('does not sound or consume the shared watermark when disposed while waiting for a browser lock', async () => {
  let release: () => void = () => { throw new Error('No pending browser lock') }
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_name: string, callback: () => void) => new Promise<void>((resolve) => { release = () => { callback(); resolve() } }) } })
  const { unmount } = renderHook(() => useNotificationInbox('viewer', inbox))
  fireEvent.pointerDown(window)
  inbox = { ...inbox, notifications: [item(2)], unread: 2 }
  await poll()
  unmount()
  await act(async () => { release() })
  expect(playNotificationTone).not.toHaveBeenCalled()
  expect(localStorage.getItem('notification-sound-viewer')).toBeNull()
})
