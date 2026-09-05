import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import styles from '../auth.module.css'

import { LoginForm } from '@/components/auth/login-form'
import { getActiveSession } from '@/lib/auth/session'
import { safeReturnTo } from '@/lib/auth/validation'

export const metadata: Metadata = { title: 'Sign in' }
export const dynamic = 'force-dynamic'

interface LoginPageProps {
  searchParams: Promise<{ returnTo?: string }>
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
        <p>Sign in once to watch pages, HLS, and low-latency WebRTC.</p>
        <LoginForm returnTo={returnTo} />
        <p className={styles.authFootnote}>
          Need an account? <Link href="/register">Request access</Link>
        </p>
      </section>
    </main>
  )
}
