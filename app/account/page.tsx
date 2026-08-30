import type { Metadata } from 'next'
import Link from 'next/link'

import { ChangePasswordForm } from '@/components/auth/change-password-form'
import { requireActiveSession } from '@/lib/auth/session'
import { listUserSessions } from '@/lib/auth/store'
import { getOwnedChannel } from '@/lib/channels'
import { buttonVariants } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Account' }
export const dynamic = 'force-dynamic'

export default async function AccountPage() {
  const session = await requireActiveSession()
  const sessions = listUserSessions(session.user.id)
  const channel = getOwnedChannel(session.user.id)

  return (
    <main className="account-layout">
      <section>
        <p className="eyebrow">Account</p>
        <h1>{session.user.name}</h1>
        <p>{session.user.email}</p>
      </section>
      <section className="account-panel">
        <h2>My channel</h2>
        <p>
          {channel
            ? `Manage OBS publishing for /watch/${channel.slug}.`
            : 'Streaming access has not been granted to this account.'}
        </p>
        <Link
          className={buttonVariants({ variant: 'secondary' })}
          href="/account/channel"
        >
          {channel ? 'Manage channel' : 'Channel status'}
        </Link>
      </section>
      <section className="account-panel">
        <h2>Change password</h2>
        <p>Changing it signs out every other browser session.</p>
        <ChangePasswordForm />
      </section>
      <section className="account-panel">
        <h2>Sessions</h2>
        <p>{sessions.length} active {sessions.length === 1 ? 'session' : 'sessions'}.</p>
        <ul className="account-session-list">
          {sessions.map((item) => (
            <li key={item.id}>
              {item.userAgent ?? 'Unknown device'}
              <small>Expires {item.expiresAt.toLocaleString()}</small>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
