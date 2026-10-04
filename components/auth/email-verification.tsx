'use client'
import { useState } from 'react'
import { sendVerificationAction } from '@/app/verify-email/actions'
import { Button } from '@/components/ui/button'
import styles from './email-verification.module.css'

export function EmailVerification({ email, legacy = false, buttonClassName }: { email: string; legacy?: boolean; buttonClassName?: string }) {
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  return <div className={styles.verification}>
    <div className={styles.copy}>
    <p>{legacy ? 'Your current access stays available. Verify your email to enable password recovery.' : 'Verify your email before publishing or requesting viewing access. You can manage your channel now.'}</p>
    <p className={styles.email}>{email}</p>
    </div>
    <Button className={buttonClassName} disabled={pending} onClick={async () => {
      setPending(true)
      const result = await sendVerificationAction()
      setMessage(result.error ?? 'Verification email sent. Check your inbox. You can request another link after one minute.')
      setPending(false)
    }}>{pending ? 'Sending…' : 'Send verification email'}</Button>
    {message && <p className={styles.status} role="status">{message}</p>}
  </div>
}
