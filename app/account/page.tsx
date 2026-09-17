import type { Metadata } from 'next'
import Link from 'next/link'

import { ArrowUpRight, LockKeyhole, RadioTower } from 'lucide-react'

import { AccountSessions, ProfileNameForm } from './account-details'
import { ChangePasswordForm } from '@/components/auth/change-password-form'
import { requireActiveSession } from '@/lib/auth/session'
import { listUserSessions } from '@/lib/auth/store'
import { getOwnedChannel } from '@/lib/channels'
import styles from './account.module.css'

export const metadata: Metadata = { title: 'Account' }
export const dynamic = 'force-dynamic'

interface AccountPageProps {
  searchParams: Promise<{ notice?: string; error?: string }>
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const [session, params] = await Promise.all([
    requireActiveSession(),
    searchParams,
  ])
  const sessions = listUserSessions(session.user.id)
  const channel = getOwnedChannel(session.user.id)

  return (
    <main className={styles.dashboard}>
      <header className={styles.heading}>
        <p className="eyebrow">Account</p>
        <h1>Account settings</h1>
        <p><strong>{session.user.name}</strong><span aria-hidden="true">·</span>{session.user.email}</p>
      </header>
      {params.notice && <p className="notice-banner" role="status">{params.notice}</p>}
      {params.error && <p className="error-banner" role="alert">{params.error}</p>}
      <div className={styles.columns}>
        <div className={styles.settings}>
          <ProfileNameForm key={session.user.name} name={session.user.name} />
          <section className={`${styles.card} ${styles.channelCard}`}>
            <div>
              <h2><RadioTower aria-hidden="true" /> My channel</h2>
              <p>{channel ? `OBS publishing · /watch/${channel.slug}` : 'Streaming access has not been granted to this account.'}</p>
            </div>
            <Link className={styles.secondaryButton} href="/account/channel">
              {channel ? 'Manage channel' : 'Channel status'} <ArrowUpRight aria-hidden="true" />
            </Link>
          </section>
          <section className={styles.card}>
            <h2><LockKeyhole aria-hidden="true" /> Change password</h2>
            <p>Changing it signs out every other browser session.</p>
            <ChangePasswordForm />
          </section>
        </div>
        <AccountSessions sessions={sessions} />
      </div>
    </main>
  )
}
