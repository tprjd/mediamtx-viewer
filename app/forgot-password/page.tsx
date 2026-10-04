import Link from 'next/link'
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'
import styles from '../auth.module.css'
export default function ForgotPasswordPage() {
  return <main className={styles.authLayout}><section className={styles.authCard}>
    <p className="eyebrow">Account recovery</p><h1>Forgot password?</h1>
    <p>Enter your verified account email.</p><ForgotPasswordForm />
    <p>For Google or Discord accounts, use your provider to recover access. If you have not verified your email, ask an administrator for a reset link.</p>
    <p className={styles.authFootnote}><Link href="/login">Back to sign in</Link></p>
  </section></main>
}
