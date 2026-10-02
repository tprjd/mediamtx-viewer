'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth/client'
import type { OAuthProvider } from '@/lib/auth/oauth'
import { providerErrorMessage, providerNames } from '@/lib/auth/provider-messages'
import { safeReturnTo } from '@/lib/auth/validation'
import styles from './providers.module.css'

export function ProviderSignIn({ providers, returnTo = '/' }: { providers: OAuthProvider[]; returnTo?: string }) {
  const [pending, setPending] = useState<OAuthProvider | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!providers.length) return null

  async function signIn(provider: OAuthProvider) {
    setPending(provider)
    setError(null)
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: safeReturnTo(returnTo),
        errorCallbackURL: `/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`,
      })
      if (!result.error) return
      setError(providerErrorMessage(result.error.code))
    } catch {
      setError(providerErrorMessage())
    }
    setPending(null)
  }

  return (
    <div className={styles.signIn}>
      <div className={styles.buttons}>
        {providers.map((provider) => (
          <Button key={provider} variant="secondary" disabled={pending !== null} onClick={() => void signIn(provider)}>
            {pending === provider ? 'Connecting…' : `Continue with ${providerNames[provider]}`}
          </Button>
        ))}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className={styles.divider}>or use your account credentials</p>
    </div>
  )
}
