'use client'

import { Link2, LockKeyhole } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { ChangePasswordForm } from './change-password-form'
import { authClient } from '@/lib/auth/client'
import type { OAuthProvider } from '@/lib/auth/oauth'
import { providerErrorMessage, providerNames } from '@/lib/auth/provider-messages'
import type { getSignInMethods } from '@/lib/auth/sign-in-methods'
import styles from '@/app/account/account.module.css'
import providerStyles from './providers.module.css'

export function AccountSignInMethods({ methods }: { methods: ReturnType<typeof getSignInMethods> }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function updateProviderLink(provider: OAuthProvider, accountId?: string) {
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      if (accountId) {
        const result = await authClient.unlinkAccount({ accountId })
        if (result.error) setError(providerErrorMessage(result.error.code))
        else {
          setNotice(`${providerNames[provider]} disconnected.`)
          router.refresh()
        }
      } else {
        const result = await authClient.linkSocial({
          provider, callbackURL: '/account?providerResult=linked', errorCallbackURL: '/account?providerResult=error',
        })
        if (!result.error) return
        setError(providerErrorMessage(result.error.code))
      }
    } catch {
      setError(providerErrorMessage())
    }
    setPending(false)
  }

  return (
    <>
      {(methods.configured.length > 0 || methods.providers.length > 0) && (
        <section className={styles.card}>
          <h2><Link2 aria-hidden="true" /> Sign-in methods</h2>
          <p>Link Google or Discord to sign in to this account. A different provider email is allowed. Your site email stays the same.</p>
          <ul className={providerStyles.methods}>
            {methods.providers.map((account) => (
              <li key={account.id}>
                <span>{providerNames[account.provider]}<small>{methods.configured.includes(account.provider) ? 'Connected' : 'Unavailable on this site'}</small></span>
                <button className={styles.secondaryButton} disabled={pending || !account.canDisconnect} onClick={() => void updateProviderLink(account.provider, account.id)}>
                  Disconnect {providerNames[account.provider]}
                </button>
              </li>
            ))}
            {methods.configured.filter((provider) => !methods.providers.some((account) => account.provider === provider)).map((provider) => (
              <li key={provider}>
                <span>{providerNames[provider]}<small>Not connected</small></span>
                <button className={styles.secondaryButton} disabled={pending} onClick={() => void updateProviderLink(provider)}>Link {providerNames[provider]}</button>
              </li>
            ))}
          </ul>
          <p>Keep at least one usable sign-in method connected.</p>
          {pending && <p role="status">Updating sign-in methods…</p>}
          {notice && <p role="status">{notice}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </section>
      )}
      {methods.hasPassword && (
        <section className={styles.card}>
          <h2><LockKeyhole aria-hidden="true" /> Change password</h2>
          <p>Changing it signs out every other browser session.</p>
          <ChangePasswordForm />
        </section>
      )}
    </>
  )
}
