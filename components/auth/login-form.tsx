'use client'

import { LoaderCircle, LogIn } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth/client'
import { loginSchema, safeReturnTo } from '@/lib/auth/validation'

interface LoginFormProps {
  returnTo?: string
}

export function LoginForm({ returnTo }: LoginFormProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)
    const parsed = loginSchema.safeParse({
      username: form.get('username'),
      password: form.get('password'),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your login details.')
      return
    }

    setPending(true)
    const result = await authClient.signIn.username(parsed.data)
    if (result.error) {
      const code = result.error.code
      setError(
        code === 'ACCOUNT_PENDING'
          ? 'Your account is waiting for approval.'
          : code === 'ACCOUNT_DISABLED' || code === 'BANNED_USER'
            ? 'This account is disabled.'
            : 'The username or password is incorrect.',
      )
      setPending(false)
      return
    }

    router.replace(safeReturnTo(returnTo))
    router.refresh()
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        <span>Username</span>
        <input
          autoCapitalize="none"
          autoComplete="username"
          autoFocus
          maxLength={30}
          name="username"
          required
        />
      </label>
      <label>
        <span>Password</span>
        <input
          autoComplete="current-password"
          maxLength={128}
          name="password"
          required
          type="password"
        />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button disabled={pending} type="submit">
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <LogIn className="size-4" aria-hidden="true" />
        )}
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
