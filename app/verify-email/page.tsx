import Link from 'next/link'
import { getActiveSession } from '@/lib/auth/session'
import { getAccountAccess } from '@/lib/viewing-access'
import { EmailVerification } from '@/components/auth/email-verification'
import { Button, buttonVariants } from '@/components/ui/button'
import { verifyEmailAction } from './actions'
import styles from '../auth.module.css'

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string; verified?: string }> }) {
  const params = await searchParams
  const session = await getActiveSession()
  const account = session ? getAccountAccess(session.user.id) : undefined
  return <main className={styles.authLayout}><section className={styles.authCard}>
    <p className="eyebrow">Account email</p><h1>Verify your email.</h1>
    {params.error && <p className="error-banner">This link has expired or was already used. Sign in and request a new link.</p>}
    {params.verified || account?.emailVerified ? <><p>Email verified. You can publish and request viewing access.</p><Link className={buttonVariants()} href={session ? '/account/channel' : '/login'}>{session ? 'My channel' : 'Sign in'}</Link></> : params.token ? <form action={verifyEmailAction} className="auth-form"><input type="hidden" name="token" value={params.token} /><p>Confirm this email address for your account.</p><Button type="submit">Verify email</Button></form> : session ? <EmailVerification email={session.user.email} legacy={Boolean(account?.legacyAccess)} /> : <p><Link href="/login?returnTo=/verify-email">Sign in</Link> to request a verification email.</p>}
  </section></main>
}
