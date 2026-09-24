import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionRenewal } from '@/components/auth/session-renewal'

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/auth/client', () => ({ authClient: { getSession } }))

async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms))
}

describe('SessionRenewal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getSession.mockReset().mockResolvedValue({ data: { user: { activationStatus: 'active' } } })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renews on mount and every five minutes without rendering a playback overlay', async () => {
    const { container } = render(<SessionRenewal />)
    await advance(0)
    expect(getSession).toHaveBeenCalledOnce()
    expect(container).toBeEmptyDOMElement()
    await advance(299_999)
    expect(getSession).toHaveBeenCalledOnce()
    await advance(1)
    expect(getSession).toHaveBeenCalledTimes(2)
  })

  it.each(['hidden', 'offline'])('waits while %s and checks when the page can renew again', async (condition) => {
    if (condition === 'hidden') vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    else vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    render(<SessionRenewal />)
    await advance(600_000)
    expect(getSession).not.toHaveBeenCalled()

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    fireEvent(window, new Event('online'))
    fireEvent(document, new Event('visibilitychange'))
    await advance(0)
    expect(getSession).toHaveBeenCalledOnce()
  })

  it.each(['focus', 'pageshow'])('checks again on %s without waiting for the polling interval', async (event) => {
    render(<SessionRenewal />)
    await advance(10_000)
    fireEvent(window, new Event(event))
    await advance(0)
    expect(getSession).toHaveBeenCalledTimes(2)
    fireEvent(window, new Event(event))
    await advance(0)
    expect(getSession).toHaveBeenCalledTimes(2)
  })

  it.each([
    { data: null, error: { status: 503 } },
    new TypeError('Network unavailable'),
  ])('retries a temporary failure without treating it as access loss: %s', async (result) => {
    if (result instanceof Error) getSession.mockRejectedValueOnce(result)
    else getSession.mockResolvedValueOnce(result)
    render(<SessionRenewal />)
    await advance(30_000)
    expect(getSession).toHaveBeenCalledTimes(2)
    await advance(30_000)
    expect(getSession).toHaveBeenCalledTimes(2)
  })

  it('aborts a hung request, retries, and ignores its late denial', async () => {
    let resolve!: (result: unknown) => void
    getSession.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    render(<SessionRenewal />)
    await advance(4_999)
    fireEvent(window, new Event('focus'))
    expect(getSession).toHaveBeenCalledOnce()
    expect(getSession.mock.calls[0][0].fetchOptions.signal.aborted).toBe(false)
    await advance(1)
    expect(getSession.mock.calls[0][0].fetchOptions.signal.aborted).toBe(true)
    await advance(55_000)
    expect(getSession).toHaveBeenCalledTimes(2)
    await act(async () => { resolve({ data: null }); await Promise.resolve() })
    await advance(300_000)
    expect(getSession).toHaveBeenCalledTimes(3)
  })

  it.each([
    { data: null },
    { data: null, error: { status: 401 } },
    { data: null, error: { status: 403 } },
    { data: { user: { activationStatus: 'disabled' } } },
    { data: { user: { activationStatus: 'pending' } } },
  ])('stops renewal after confirmed access loss: %s', async (result) => {
    getSession.mockResolvedValueOnce(result)
    render(<SessionRenewal />)
    await advance(600_000)
    fireEvent(window, new Event('focus'))
    await advance(0)
    expect(getSession).toHaveBeenCalledOnce()
  })

  it('aborts the pending request and removes timers and listeners on unmount', async () => {
    getSession.mockReturnValueOnce(new Promise(() => {}))
    const { unmount } = render(<SessionRenewal />)
    unmount()
    expect(getSession.mock.calls[0][0].fetchOptions.signal.aborted).toBe(true)
    fireEvent(window, new Event('online'))
    fireEvent(window, new Event('focus'))
    await advance(600_000)
    expect(getSession).toHaveBeenCalledOnce()
  })
})
