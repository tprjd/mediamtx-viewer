'use client'
import { useActionState } from 'react'
import { forgotPasswordAction } from '@/app/forgot-password/actions'
import { Button } from '@/components/ui/button'
export function ForgotPasswordForm() {
  const [message, action, pending] = useActionState(forgotPasswordAction, '')
  return <form className="auth-form" action={action}>
    <label><span>Email</span><input type="email" name="email" autoComplete="email" maxLength={254} required /></label>
    <Button type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send reset link'}</Button>
    {message && <p role="status">{message}</p>}
  </form>
}
