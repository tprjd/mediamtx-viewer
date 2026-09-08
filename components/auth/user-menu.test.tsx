import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UserMenu } from '@/components/auth/user-menu'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/auth/client', () => ({
  authClient: { signOut: vi.fn() },
}))

afterEach(cleanup)

describe('UserMenu', () => {
  it('opens account actions from an initial control', async () => {
    render(
      <UserMenu
        hasOwnedChannel={false}
        user={{ name: 'Regular Viewer', role: 'user' }}
      />,
    )

    const trigger = screen.getByRole('button', {
      name: 'Open account menu for Regular Viewer',
    })
    expect(trigger).toHaveTextContent('RV')
    expect(screen.queryByRole('menuitem', { name: 'Statistics' })).toBeNull()

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })

    expect(screen.getByRole('menuitem', { name: 'Statistics' })).toHaveAttribute(
      'href',
      '/statistics',
    )
    expect(screen.queryByRole('menuitem', { name: 'Admin' })).toBeNull()
  })

  it('keeps user management in the administrator account menu', () => {
    render(
      <UserMenu
        hasOwnedChannel={false}
        user={{ name: 'Administrator', role: 'admin' }}
      />,
    )

    fireEvent.pointerDown(
      screen.getByRole('button', {
        name: 'Open account menu for Administrator',
      }),
      { button: 0, ctrlKey: false },
    )

    expect(screen.getByRole('menuitem', { name: 'Statistics' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Admin' })).toHaveAttribute(
      'href',
      '/admin/users',
    )
  })

  it('returns focus to the account control after the menu closes', async () => {
    render(
      <UserMenu
        hasOwnedChannel={false}
        user={{ name: 'Viewer', role: 'user' }}
      />,
    )

    const trigger = screen.getByRole('button', {
      name: 'Open account menu for Viewer',
    })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
