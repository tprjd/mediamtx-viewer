'use client'

import { useState } from 'react'
import Image from 'next/image'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth/client'
import type { OAuthProvider } from '@/lib/auth/oauth'
import { providerErrorMessage, providerNames } from '@/lib/auth/provider-messages'
import { safeReturnTo } from '@/lib/auth/validation'
import googleLogo from '@/public/brands/google-g.png'
import discordLogo from '@/public/brands/discord-white.svg'
import styles from './providers.module.css'

// Brand assets: https://developers.google.com/identity/branding-guidelines
// and https://discord.com/branding. Keep each provider's logo colors intact.
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
          <Button
            key={provider}
            variant="secondary"
            className={`${styles.providerButton} ${styles[provider]}`}
            disabled={pending !== null}
            aria-busy={pending === provider}
            onClick={() => void signIn(provider)}
          >
            <Image
              src={provider === 'google' ? googleLogo : discordLogo}
              alt=""
              width={provider === 'google' ? 20 : 24}
              height={provider === 'google' ? 20 : 18}
              className={styles.providerLogo}
              unoptimized
            />
            <span>{pending === provider ? 'Connecting…' : `Continue with ${providerNames[provider]}`}</span>
          </Button>
        ))}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className={styles.divider}>or use your account credentials</p>
    </div>
  )
}
