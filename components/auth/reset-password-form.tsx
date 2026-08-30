'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { resetPasswordAction, type ResetState } from '@/app/reset-password/actions'
import { Button } from '@/components/ui/button'

const initialState: ResetState = { status: 'idle' }

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, initialState)

  if (state.status === 'success') {
    return (
      <div className="form-success" role="status">
        <p>{state.message}</p>
        <Link className="text-link" href="/login">Sign in</Link>
      </div>
    )
  }

  return (
    <form action={action} className="auth-form">
      <input name="token" type="hidden" value={token} />
      <label>
        <span>New password</span>
        <input autoComplete="new-password" minLength={15} name="password" required type="password" />
      </label>
      <label>
        <span>Confirm new password</span>
        <input autoComplete="new-password" minLength={15} name="confirmPassword" required type="password" />
      </label>
      {state.status === 'error' && <p className="form-error" role="alert">{state.message}</p>}
      <Button disabled={pending} type="submit">
        {pending ? 'Changing…' : 'Set new password'}
      </Button>
    </form>
  )
}

