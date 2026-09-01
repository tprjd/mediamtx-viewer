import { cleanup, render, screen } from '@testing-library/react'
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
  it('shows statistics to a regular signed-in viewer', () => {
    render(
      <UserMenu
        hasOwnedChannel={false}
        user={{ name: 'Viewer', role: 'user' }}
      />,
    )

    expect(screen.getByRole('link', { name: 'Statistics' })).toHaveAttribute(
      'href',
      '/statistics',
    )
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull()
  })

  it('keeps user management available to administrators', () => {
    render(
      <UserMenu
        hasOwnedChannel={false}
        user={{ name: 'Administrator', role: 'admin' }}
      />,
    )

    expect(screen.getByRole('link', { name: 'Statistics' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute(
      'href',
      '/admin/users',
    )
  })
})
