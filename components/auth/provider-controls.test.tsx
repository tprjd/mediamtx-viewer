import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { ProviderSignIn } from './provider-sign-in'
import { AccountSignInMethods } from './account-sign-in-methods'
import { authClient } from '@/lib/auth/client'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/lib/auth/client', () => ({ authClient: {
  signIn: { social: vi.fn() }, linkSocial: vi.fn(), unlinkAccount: vi.fn(),
} }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('starts Google sign-in with the return destination and recovers from network failure', async () => {
  vi.mocked(authClient.signIn.social).mockRejectedValueOnce(new Error('offline'))
  render(<ProviderSignIn providers={['google']} returnTo="/watch/friends" />)
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not connect'))
  expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Continue with Discord' })).not.toBeInTheDocument()
  expect(authClient.signIn.social).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google', callbackURL: '/watch/friends' }))
})

it('hides password controls and prevents disconnect of the final sign-in method', () => {
  render(<AccountSignInMethods methods={{ hasPassword: false, configured: ['google', 'discord'], providers: [{ id: 'google-id', provider: 'google', canDisconnect: false }] }} />)
  expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Disconnect Google' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Link Discord' })).toBeEnabled()
})

it('links Discord from Account settings and reports a failed request', async () => {
  vi.mocked(authClient.linkSocial).mockResolvedValueOnce({ data: null, error: { message: 'expired', status: 401, statusText: 'Unauthorized', code: 'LINK_SESSION_REQUIRED' } })
  render(<AccountSignInMethods methods={{ hasPassword: true, configured: ['discord'], providers: [] }} />)
  expect(screen.getByLabelText('Current password')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Link Discord' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Sign in again'))
  expect(authClient.linkSocial).toHaveBeenCalledWith({ provider: 'discord', callbackURL: '/account?providerResult=linked', errorCallbackURL: '/account?providerResult=error' })
})

it('disconnects the selected account and refreshes the account controls', async () => {
  vi.mocked(authClient.unlinkAccount).mockResolvedValueOnce({ data: { status: true }, error: null })
  render(<AccountSignInMethods methods={{ hasPassword: true, configured: ['google'], providers: [{ id: 'google-id', provider: 'google', canDisconnect: true }] }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect Google' }))
  await waitFor(() => expect(refresh).toHaveBeenCalled())
  expect(authClient.unlinkAccount).toHaveBeenCalledWith({ accountId: 'google-id' })
  expect(screen.getByRole('status')).toHaveTextContent('Google disconnected')
})

it('shows a safe fallback for an unknown provider error code', async () => {
  vi.mocked(authClient.signIn.social).mockResolvedValueOnce({ data: null, error: { message: 'unknown', status: 400, statusText: 'Bad Request', code: '__proto__' } })
  render(<ProviderSignIn providers={['google']} />)
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not connect to the provider. Try again.'))
})
