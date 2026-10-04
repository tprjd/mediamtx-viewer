import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import styles from '../auth.module.css'

import { LoginForm } from '@/components/auth/login-form'
import { ProviderSignIn } from '@/components/auth/provider-sign-in'
import { configuredProviders } from '@/lib/auth/oauth'
import { providerErrorMessage } from '@/lib/auth/provider-messages'
import { getActiveSession } from '@/lib/auth/session'
import { safeReturnTo } from '@/lib/auth/validation'

export const metadata: Metadata = { title: 'Sign in' }
export const dynamic = 'force-dynamic'

interface LoginPageProps {
  searchParams: Promise<{ returnTo?: string; error?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const returnTo = safeReturnTo(params.returnTo)
  if (await getActiveSession()) redirect(returnTo)

  return (
    <main className={styles.authLayout}>
      <section className={styles.authCard}>
        <p className="eyebrow">Private stream</p>
        <h1>Welcome back.</h1>
        {params.error && <p className="form-error" role="alert">{providerErrorMessage(params.error)}</p>}
        <ProviderSignIn providers={configuredProviders()} returnTo={returnTo} />
        <LoginForm returnTo={returnTo} />
        <p className={styles.authFootnote}><Link href="/forgot-password">Forgot password?</Link></p>
        <p className={styles.authFootnote}>
          Need an account? <Link href="/register">Create account</Link>
        </p>
      </section>
    </main>
  )
}
