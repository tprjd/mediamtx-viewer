import {
  Clock3,
  KeyRound,
  RadioTower,
  ShieldCheck,
  UserCheck,
  UserX,
} from 'lucide-react'
import Link from 'next/link'

import {
  activateAction,
  channelEnabledAction,
  disableAction,
  grantStreamingAction,
  registrationAction,
  rejectAction,
  resetLinkAction,
  revokeAllSessionsAction,
  revokeSessionAction,
} from '@/app/admin/users/actions'
import { ClearActivityControl } from '@/components/admin/clear-activity-control'
import { Button, buttonVariants } from '@/components/ui/button'
import { requireAdminSession } from '@/lib/auth/session'
import {
  getRegistrationOpen,
  listAuditEntries,
  listUsers,
  listUserSessions,
} from '@/lib/auth/store'
import type { AuthUser } from '@/lib/auth/types'
import { listAdminChannels, type AdminChannel } from '@/lib/channels'

export const dynamic = 'force-dynamic'

interface AdminUsersPageProps {
  searchParams: Promise<{ notice?: string; error?: string; reset?: string }>
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function defaultSlug(user: AuthUser): string {
  return (user.username ?? user.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

function UserCard({
  user,
  currentUserId,
  channel,
}: {
  user: AuthUser
  currentUserId: string
  channel?: AdminChannel
}) {
  const sessions = listUserSessions(user.id)

  return (
    <article className="user-card">
      <div className="user-card-heading">
        <div>
          <div className="user-title-line">
            <h3>{user.name}</h3>
            {user.role === 'admin' && <span className="role-badge">Admin</span>}
          </div>
          <p>@{user.username} · {user.email}</p>
        </div>
        <span className={`activation-badge activation-${user.activationStatus}`}>
          {user.activationStatus}
        </span>
      </div>

      <p className="user-meta">
        Registered {formatDate(user.createdAt)}
        {user.activatedAt ? ` · Activated ${formatDate(user.activatedAt)}` : ''}
      </p>

      <div className="admin-actions">
        {user.activationStatus !== 'active' && (
          <form action={activateAction.bind(null, user.id)}>
            <Button size="sm" type="submit">
              <UserCheck className="size-4" aria-hidden="true" /> Activate
            </Button>
          </form>
        )}
        {user.activationStatus === 'active' && user.id !== currentUserId && (
          <form action={disableAction.bind(null, user.id)}>
            <Button size="sm" type="submit" variant="secondary">
              <UserX className="size-4" aria-hidden="true" /> Disable
            </Button>
          </form>
        )}
        {user.activationStatus === 'pending' && (
          <form action={rejectAction.bind(null, user.id)}>
            <Button size="sm" type="submit" variant="ghost">Reject</Button>
          </form>
        )}
        {user.activationStatus !== 'pending' && (
          <form action={resetLinkAction.bind(null, user.id)}>
            <Button size="sm" type="submit" variant="ghost">
              <KeyRound className="size-4" aria-hidden="true" /> Reset link
            </Button>
          </form>
        )}
        {sessions.length > 0 && (
          <form action={revokeAllSessionsAction.bind(null, user.id)}>
            <Button size="sm" type="submit" variant="ghost">Revoke all sessions</Button>
          </form>
        )}
      </div>

      {sessions.length > 0 && (
        <details className="session-list">
          <summary>{sessions.length} active {sessions.length === 1 ? 'session' : 'sessions'}</summary>
          {sessions.map((session) => (
            <div className="session-row" key={session.id}>
              <span>
                {session.userAgent ?? 'Unknown device'}
                <small>Expires {formatDate(session.expiresAt)}</small>
              </span>
              <form action={revokeSessionAction.bind(null, session.id)}>
                <Button size="sm" type="submit" variant="ghost">Revoke</Button>
              </form>
            </div>
          ))}
        </details>
      )}

      {user.activationStatus === 'active' && !channel && (
        <form
          action={grantStreamingAction.bind(null, user.id)}
          className="streaming-grant"
        >
          <label>
            Channel slug
            <input
              defaultValue={defaultSlug(user)}
              maxLength={64}
              name="slug"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              required
            />
          </label>
          <Button size="sm" type="submit" variant="secondary">
            <RadioTower className="size-4" aria-hidden="true" /> Grant streaming
          </Button>
        </form>
      )}

      {channel && (
        <div className="admin-channel-summary">
          <div>
            <strong>Channel: /watch/{channel.slug}</strong>
            <small>
              {channel.enabled ? 'Enabled' : 'Disabled'} · Key{' '}
              {channel.streamKeyHint ? `ending ${channel.streamKeyHint}` : 'not generated'}
            </small>
          </div>
          <div className="admin-actions">
            {channel.enabled && (
              <Link
                className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                href={`/watch/${channel.slug}`}
              >
                View
              </Link>
            )}
            <form action={channelEnabledAction.bind(null, user.id)}>
              <input name="enabled" type="hidden" value={channel.enabled ? 'false' : 'true'} />
              <Button size="sm" type="submit" variant="secondary">
                {channel.enabled ? 'Disable channel' : 'Enable channel'}
              </Button>
            </form>
          </div>
        </div>
      )}
    </article>
  )
}

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const [session, params] = await Promise.all([requireAdminSession(), searchParams])
  const users = listUsers()
  const channels = listAdminChannels()
  const channelsByOwner = new Map(channels.map((channel) => [channel.ownerUserId, channel]))
  const registrationOpen = getRegistrationOpen()
  const auditEntries = listAuditEntries()
  const groups = {
    pending: users.filter((user) => user.activationStatus === 'pending'),
    active: users.filter((user) => user.activationStatus === 'active'),
    disabled: users.filter((user) => user.activationStatus === 'disabled'),
  }
  const resetUrl = params.reset
    ? `${process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'}/reset-password?token=${encodeURIComponent(params.reset)}`
    : null

  return (
    <main className="admin-layout">
      <section className="admin-heading">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Viewer access</h1>
          <p>Approve friends, disable access, and revoke database sessions.</p>
        </div>
        <form action={registrationAction} className="registration-control">
          <input name="open" type="hidden" value={registrationOpen ? 'false' : 'true'} />
          <span>Registration is <strong>{registrationOpen ? 'open' : 'closed'}</strong></span>
          <Button type="submit" variant="secondary">
            {registrationOpen ? 'Close registration' : 'Open registration'}
          </Button>
        </form>
      </section>

      {params.notice && <p className="notice-banner">{params.notice}</p>}
      {params.error && <p className="error-banner" role="alert">{params.error}</p>}
      {resetUrl && (
        <aside className="reset-banner">
          <strong>One-time reset link (expires in 15 minutes)</strong>
          <p>{resetUrl}</p>
          <small>Copy it now. Reloading this page hides it.</small>
        </aside>
      )}

      {(['pending', 'active', 'disabled'] as const).map((status) => (
        <section className="user-group" key={status}>
          <div className="user-group-heading">
            {status === 'pending' ? <Clock3 /> : status === 'active' ? <UserCheck /> : <UserX />}
            <h2>{status[0].toUpperCase() + status.slice(1)}</h2>
            <span>{groups[status].length}</span>
          </div>
          <div className="user-grid">
            {groups[status].length > 0 ? (
              groups[status].map((user) => (
                <UserCard
                  channel={channelsByOwner.get(user.id)}
                  currentUserId={session.user.id}
                  key={user.id}
                  user={user}
                />
              ))
            ) : (
              <p className="empty-state">No {status} accounts.</p>
            )}
          </div>
        </section>
      ))}

      <section className="audit-section">
        <div className="audit-heading">
          <div className="user-group-heading">
            <ShieldCheck />
            <h2>Recent activity</h2>
          </div>
          <ClearActivityControl disabled={auditEntries.length === 0} />
        </div>
        {auditEntries.length > 0 ? (
          <div className="audit-list">
            {auditEntries.map((entry) => (
              <p key={entry.id}>
                <strong>{entry.actorName}</strong> {entry.action.replaceAll('_', ' ')}
                {entry.targetName ? ` · ${entry.targetName}` : ''}
                <time>{formatDate(entry.createdAt)}</time>
              </p>
            ))}
          </div>
        ) : (
          <p className="empty-state">No recent activity.</p>
        )}
      </section>
    </main>
  )
}
