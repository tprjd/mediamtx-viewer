import type { Metadata } from 'next'
import Link from 'next/link'
import styles from '../auth.module.css'

import { RegisterForm } from '@/components/auth/register-form'
import { getRegistrationOpen } from '@/lib/auth/store'

export const metadata: Metadata = { title: 'Request access' }
export const dynamic = 'force-dynamic'

export default function RegisterPage() {
  const registrationOpen = getRegistrationOpen()

  return (
    <main className={styles.authLayout}>
      <section className={styles.authCard}>
        <p className="eyebrow">Account access</p>
        <h1>{registrationOpen ? 'Request an account.' : 'Registration is closed.'}</h1>
        {registrationOpen ? (
          <>
            <p>An administrator must activate your account before you can sign in.</p>
            <RegisterForm />
          </>
        ) : (
          <p>Ask the administrator to open a registration window for you.</p>
        )}
        <p className={styles.authFootnote}>
          Already registered? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  )
}
