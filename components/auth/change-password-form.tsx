'use client'

import { useState, type FormEvent } from 'react'

import styles from '@/app/account/account.module.css'
import { authClient } from '@/lib/auth/client'

export function ChangePasswordForm() {
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [visible, setVisible] = useState<Record<string, boolean>>({})

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
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      })
      if (result.error) {
        setMessage('The current password is incorrect or the password could not be changed.')
        return
      }
      formElement.reset()
      setVisible({})
      setMessage('Password changed. Other sessions were signed out.')
    } catch {
      setMessage('The password could not be changed. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      {[
        { name: 'currentPassword', label: 'Current password', autoComplete: 'current-password' },
        { name: 'newPassword', label: 'New password', autoComplete: 'new-password' },
        { name: 'confirmation', label: 'Confirm new password', autoComplete: 'new-password' },
      ].map((field) => (
        <div className={styles.passwordField} key={field.name}>
          <label htmlFor={field.name}>{field.label}{field.name === 'newPassword' && <small>15 characters minimum</small>}</label>
          <div className={styles.passwordInput}>
            <input id={field.name} autoComplete={field.autoComplete} minLength={field.name === 'currentPassword' ? undefined : 15} name={field.name} required type={visible[field.name] ? 'text' : 'password'} />
            <button type="button" aria-label={`${visible[field.name] ? 'Hide' : 'Show'} ${field.label.toLowerCase()}`} aria-pressed={Boolean(visible[field.name])} onClick={() => setVisible({ ...visible, [field.name]: !visible[field.name] })}>{visible[field.name] ? 'Hide' : 'Show'}</button>
          </div>
        </div>
      ))}
      {message && <p className="form-message" role="status">{message}</p>}
      <button className={styles.primaryButton} disabled={pending} type="submit">
        {pending ? 'Changing…' : 'Change password'}
      </button>
    </form>
  )
}
