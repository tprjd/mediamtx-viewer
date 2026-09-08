import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WatchRailToggle } from '@/components/watch-rail-toggle'
import { LIVE_RAIL_PREFERENCE_STORAGE_KEY } from '@/lib/live-rail-preferences'

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
}))

beforeEach(() => {
  window.localStorage.clear()
  mocks.usePathname.mockReturnValue('/watch/live')
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.clearAllMocks()
})

describe('WatchRailToggle', () => {
  it('is visible only on watch pages', () => {
    const { rerender } = render(<WatchRailToggle />)

    expect(screen.getByRole('button', { name: 'Hide live rail' })).toBeInTheDocument()

    mocks.usePathname.mockReturnValue('/account')
    rerender(<WatchRailToggle />)

    expect(screen.queryByRole('button', { name: 'Hide live rail' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show live rail' })).toBeNull()
  })

  it('hides and restores the rail while persisting the choice', () => {
    render(<WatchRailToggle />)

    fireEvent.click(screen.getByRole('button', { name: 'Hide live rail' }))

    expect(window.localStorage.getItem(LIVE_RAIL_PREFERENCE_STORAGE_KEY)).toBe('hidden')
    expect(screen.getByRole('button', { name: 'Show live rail' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show live rail' }))

    expect(window.localStorage.getItem(LIVE_RAIL_PREFERENCE_STORAGE_KEY)).toBe('expanded')
    expect(screen.getByRole('button', { name: 'Hide live rail' })).toBeInTheDocument()
  })
})
