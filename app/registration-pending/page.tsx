import { Clock3 } from 'lucide-react'
import Link from 'next/link'
import styles from '../auth.module.css'

export default function RegistrationPendingPage() {
  return (
    <main className={styles.authLayout}>
      <section className={`${styles.authCard} ${styles.authCardCentered}`}>
        <span className={styles.authIcon}><Clock3 aria-hidden="true" /></span>
        <p className="eyebrow">Request received</p>
        <h1>Waiting for approval.</h1>
        <p>The administrator will tell you when your account is active.</p>
        <Link className="text-link" href="/login">Return to sign in</Link>
      </section>
    </main>
  )
}
