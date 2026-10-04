import type { Metadata } from 'next'
import Link from 'next/link'
import styles from '../auth.module.css'

import { RegisterForm } from '@/components/auth/register-form'
import { ProviderSignIn } from '@/components/auth/provider-sign-in'
import { configuredProviders } from '@/lib/auth/oauth'

export const metadata: Metadata = { title: 'Create account' }
export const dynamic = 'force-dynamic'

export default function RegisterPage() {
  return (
    <main className={styles.authLayout}>
      <section className={styles.authCard}>
        <p className="eyebrow">Account access</p>
        <h1>Create an account.</h1>
        <p>Your channel is created with your account. Verify your email to stream and request permission to watch other channels.</p>
        <ProviderSignIn providers={configuredProviders()} />
        <RegisterForm />
        <p className={styles.authFootnote}>Already registered? <Link href="/login">Sign in</Link></p>
      </section>
    </main>
  )
}
