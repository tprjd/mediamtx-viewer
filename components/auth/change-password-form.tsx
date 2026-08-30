'use client'

import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth/client'

export function ChangePasswordForm() {
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const currentPassword = String(form.get('currentPassword') ?? '')
    const newPassword = String(form.get('newPassword') ?? '')
    const confirmation = String(form.get('confirmation') ?? '')
    if (newPassword.length < 15) {
      setMessage('The new password must be at least 15 characters.')
      return
    }
    if (newPassword !== confirmation) {
      setMessage('The new passwords do not match.')
      return
    }

    setPending(true)
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    })
    setPending(false)
    if (result.error) {
      setMessage('The current password is incorrect or the password could not be changed.')
      return
    }
    formElement.reset()
    setMessage('Password changed. Other sessions were signed out.')
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        <span>Current password</span>
        <input autoComplete="current-password" name="currentPassword" required type="password" />
      </label>
      <label>
        <span>New password</span>
        <input autoComplete="new-password" minLength={15} name="newPassword" required type="password" />
      </label>
      <label>
        <span>Confirm new password</span>
        <input autoComplete="new-password" minLength={15} name="confirmation" required type="password" />
      </label>
      {message && <p className="form-message" role="status">{message}</p>}
      <Button disabled={pending} type="submit">
        {pending ? 'Changing…' : 'Change password'}
      </Button>
    </form>
  )
}

