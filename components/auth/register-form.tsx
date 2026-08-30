'use client'

import { LoaderCircle, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth/client'
import { registrationSchema } from '@/lib/auth/validation'

export function RegisterForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)
    const parsed = registrationSchema.safeParse({
      name: form.get('name'),
      username: form.get('username'),
      email: form.get('email'),
      password: form.get('password'),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form and try again.')
      return
    }

    setPending(true)
    const result = await authClient.signUp.email(parsed.data)
    if (result.error) {
      setError(
        result.error.code === 'REGISTRATION_CLOSED'
          ? 'Registration has been closed. Ask the administrator to reopen it.'
          : 'Unable to create the account. Try another username or email.',
      )
      setPending(false)
      return
    }
    router.replace('/registration-pending')
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        <span>Display name</span>
        <input autoComplete="name" maxLength={80} name="name" required />
      </label>
      <label>
        <span>Username</span>
        <input
          autoCapitalize="none"
          autoComplete="username"
          maxLength={30}
          name="username"
          pattern="[A-Za-z0-9_.]+"
          required
        />
        <small>Letters, numbers, dots, and underscores.</small>
      </label>
      <label>
        <span>Email</span>
        <input autoComplete="email" maxLength={254} name="email" required type="email" />
      </label>
      <label>
        <span>Password</span>
        <input
          autoComplete="new-password"
          maxLength={128}
          minLength={15}
          name="password"
          required
          type="password"
        />
        <small>Use at least 15 characters. Spaces are allowed.</small>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button disabled={pending} type="submit">
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <UserPlus className="size-4" aria-hidden="true" />
        )}
        {pending ? 'Creating account…' : 'Request access'}
      </Button>
    </form>
  )
}

