import type { Metadata } from 'next'
import Link from 'next/link'

import { updateProfileNameAction } from '@/app/account/actions'
import { ChangePasswordForm } from '@/components/auth/change-password-form'
import { Button, buttonVariants } from '@/components/ui/button'
import { requireActiveSession } from '@/lib/auth/session'
import { listUserSessions } from '@/lib/auth/store'
import { getOwnedChannel } from '@/lib/channels'

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
    <main className="account-layout">
      <section>
        <p className="eyebrow">Account</p>
        <h1>{session.user.name}</h1>
        <p>{session.user.email}</p>
      </section>
      {params.notice && <p className="notice-banner">{params.notice}</p>}
      {params.error && <p className="error-banner" role="alert">{params.error}</p>}
      <section className="account-panel">
        <h2>Profile name</h2>
        <p>This name appears below your stream across the site.</p>
        <form action={updateProfileNameAction} className="channel-metadata-form">
          <label>
            Name
            <input
              autoComplete="name"
              defaultValue={session.user.name}
              maxLength={80}
              minLength={2}
              name="name"
              required
            />
          </label>
          <Button type="submit">Save name</Button>
        </form>
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
