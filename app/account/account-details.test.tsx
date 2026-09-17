import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { AccountSessions, ProfileNameForm } from './account-details'
import { ChangePasswordForm } from '@/components/auth/change-password-form'
import { authClient } from '@/lib/auth/client'

vi.mock('./actions', () => ({ updateProfileNameAction: vi.fn() }))
vi.mock('@/lib/auth/client', () => ({ authClient: { changePassword: vi.fn() } }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('pages sessions, resets the page on filtering, and reveals raw device details', () => {
  const sessions = Array.from({ length: 10 }, (_, index) => ({
    id: String(index), createdAt: new Date('2026-09-01T00:00:00Z'), expiresAt: new Date('2026-09-23T19:42:00Z'),
    userAgent: index === 9 ? null : index === 8 ? 'curl/8.0' : 'Mozilla/5.0 (Windows NT 10.0) Chrome/153.0 Safari/537.36',
  }))
  render(<AccountSessions sessions={sessions} />)
  expect(screen.getAllByRole('listitem')).toHaveLength(8)
  fireEvent.click(screen.getByRole('button', { name: /Next/ }))
  expect(screen.getByRole('status')).toHaveTextContent('9–10 of 10 sessions')
  fireEvent.click(screen.getByRole('button', { name: 'Browsers 8' }))
  expect(screen.getByRole('status')).toHaveTextContent('1–8 of 8 sessions')
  expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()
  fireEvent.click(screen.getAllByRole('button', { name: 'Details for Chrome 153' })[0])
  expect(screen.getByText(sessions[0].userAgent!)).toBeVisible()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'curl' } })
  expect(screen.getByText('No sessions found.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Other clients 2' }))
  expect(screen.getByRole('status')).toHaveTextContent('1–1 of 1 sessions')
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
})

it('enables profile saving only after a name change', () => {
  render(<ProfileNameForm name="power" />)
  expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'New name' } })
  expect(screen.getByRole('button', { name: 'Save name' })).toBeEnabled()
  expect(screen.getByText('8 / 80')).toBeVisible()
})

it('toggles passwords, checks confirmation, and recovers from a failed password request', async () => {
  vi.mocked(authClient.changePassword).mockRejectedValueOnce(new Error('Network unavailable'))
  render(<ChangePasswordForm />)
  const current = screen.getByLabelText('Current password')
  fireEvent.change(current, { target: { value: 'old-password-long-enough' } })
  fireEvent.click(screen.getByRole('button', { name: 'Show current password' }))
  expect(current).toHaveAttribute('type', 'text')
  fireEvent.click(screen.getByRole('button', { name: 'Hide current password' }))
  expect(current).toHaveAttribute('type', 'password')
  fireEvent.change(screen.getByLabelText(/New password/), { target: { value: 'new-password-long-enough' } })
  const confirmation = screen.getByLabelText('Confirm new password')
  fireEvent.change(confirmation, { target: { value: 'different-password-long-enough' } })
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
  expect(screen.getByRole('status')).toHaveTextContent('The new passwords do not match.')
  expect(authClient.changePassword).not.toHaveBeenCalled()
  fireEvent.change(confirmation, { target: { value: 'new-password-long-enough' } })
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Please try again.'))
  expect(screen.getByRole('button', { name: 'Change password' })).toBeEnabled()
  expect(authClient.changePassword).toHaveBeenCalledWith({ currentPassword: 'old-password-long-enough', newPassword: 'new-password-long-enough', revokeOtherSessions: true })
  expect(within(current.closest('form')!).getByLabelText('Current password')).toHaveValue('old-password-long-enough')
})

it('identifies Edge and Opera before their Chrome compatibility tokens', () => {
  render(<AccountSessions sessions={['Edg/128.0', 'OPR/113.0'].map((token) => ({
    id: token, createdAt: new Date('2026-09-01'), expiresAt: new Date('2026-09-23'),
    userAgent: `Mozilla/5.0 (Windows NT 10.0) Chrome/128.0 Safari/537.36 ${token}`,
  }))} />)
  expect(screen.getByText('Edge 128')).toBeVisible()
  expect(screen.getByText('Opera 113')).toBeVisible()
})
