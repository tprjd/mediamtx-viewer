import {
  Clock3,
  KeyRound,
  ShieldCheck,
  UserCheck,
  UserX,
} from 'lucide-react'
import Link from 'next/link'

import {
  administratorApprovalAction,
  activateAction,
  channelEnabledAction,
  disableAction,
  resetLinkAction,
  revokeAllSessionsAction,
  revokeSessionAction,
} from '@/app/admin/users/actions'
import { getAccountAccess } from '@/lib/viewing-access'
import { ClearActivityControl } from '@/components/admin/clear-activity-control'
import { Button, buttonVariants } from '@/components/ui/button'
import { requireAdminSession } from '@/lib/auth/session'
import {
  listAuditEntries,
  listUsers,
  listUserSessions,
} from '@/lib/auth/store'
import type { AuthUser } from '@/lib/auth/types'
import { listAdminChannels, type AdminChannel } from '@/lib/channels'
import styles from '../users.module.css'

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
  const access = getAccountAccess(user.id)

  return (
    <article className={`${styles.userCard}`}>
      <div className={`${styles.userCardHeading}`}>
        <div>
          <div className={`${styles.userTitleLine}`}>
            <h3>{user.name}</h3>
            {user.role === 'admin' && <span className={`${styles.roleBadge}`}>Admin</span>}
          </div>
          <p>{user.username ? `@${user.username} · ` : ''}{user.email}</p>
        </div>
        <span
          className={`${styles.activationBadge} ${
            user.activationStatus === 'active'
              ? styles.activationActive
              : user.activationStatus === 'pending'
                ? styles.activationPending
                : styles.activationDisabled
          }`}
        >
          {user.activationStatus === 'disabled' ? 'Suspended' : access?.administratorApproved ? 'Viewing approved' : 'By channel approval'}
        </span>
      </div>

      <p className={`${styles.userMeta}`}>
        Registered {formatDate(user.createdAt)}
        {user.activatedAt ? ` · Activated ${formatDate(user.activatedAt)}` : ''}
      </p>

      <div className={`${styles.adminActions}`}>
        {user.activationStatus === 'disabled' && (
          <form action={activateAction.bind(null, user.id)}>
            <Button size="sm" type="submit">
              <UserCheck className="size-4" aria-hidden="true" /> Restore account
            </Button>
          </form>
        )}
        {user.activationStatus === 'active' && user.id !== currentUserId && (
          <form action={disableAction.bind(null, user.id)}>
            <Button size="sm" type="submit" variant="secondary">
              <UserX className="size-4" aria-hidden="true" /> Suspend account
            </Button>
          </form>
        )}
        <form action={administratorApprovalAction.bind(null, user.id)}>
          <input name="approved" type="hidden" value={access?.administratorApproved ? 'false' : 'true'} />
          <Button size="sm" type="submit" variant="secondary">{access?.administratorApproved ? 'Remove viewing approval' : 'Approve all-channel viewing'}</Button>
        </form>
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
        <details className={`${styles.sessionList}`}>
          <summary>{sessions.length} active {sessions.length === 1 ? 'session' : 'sessions'}</summary>
          {sessions.map((session) => (
            <div className={`${styles.sessionRow}`} key={session.id}>
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

      {channel && (
        <div className={`${styles.adminChannelSummary}`}>
          <div>
            <strong>Channel: /watch/{channel.slug}</strong>
            <small>
              {channel.enabled ? 'Enabled' : 'Disabled'} · Key{' '}
              {channel.streamKeyHint ? `ending ${channel.streamKeyHint}` : 'not generated'}
            </small>
          </div>
          <div className={`${styles.adminActions}`}>
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
  const auditEntries = listAuditEntries()
  const groups = {
    unapproved: users.filter((user) => user.activationStatus !== 'disabled' && !getAccountAccess(user.id)?.administratorApproved),
    approved: users.filter((user) => user.activationStatus !== 'disabled' && getAccountAccess(user.id)?.administratorApproved),
    suspended: users.filter((user) => user.activationStatus === 'disabled'),
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
          <Link href="/admin/chat">Chat moderation records</Link>
          <p>Approve all-channel viewing, suspend accounts, and revoke sessions. Registration is open to everyone.</p>
        </div>

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

      {(['unapproved', 'approved', 'suspended'] as const).map((status) => (
        <section className={`${styles.userGroup}`} key={status}>
          <div className={`${styles.userGroupHeading}`}>
            {status === 'unapproved' ? <Clock3 /> : status === 'approved' ? <UserCheck /> : <UserX />}
            <h2>{status[0].toUpperCase() + status.slice(1)}</h2>
            <span>{groups[status].length}</span>
          </div>
          <div className={`${styles.userGrid}`}>
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
              <p className={`${styles.emptyState}`}>No {status} accounts.</p>
            )}
          </div>
        </section>
      ))}

      <section className={`${styles.auditSection}`}>
        <div className={`${styles.auditHeading}`}>
          <div className={`${styles.userGroupHeading}`}>
            <ShieldCheck />
            <h2>Recent activity</h2>
          </div>
          <ClearActivityControl disabled={auditEntries.length === 0} />
        </div>
        {auditEntries.length > 0 ? (
          <div className={`${styles.auditList}`}>
            {auditEntries.map((entry) => (
              <p key={entry.id}>
                <strong>{entry.actorName}</strong> {entry.action.replaceAll('_', ' ')}
                {entry.targetName ? ` · ${entry.targetName}` : ''}
                <time>{formatDate(entry.createdAt)}</time>
              </p>
            ))}
          </div>
        ) : (
          <p className={`${styles.emptyState}`}>No recent activity.</p>
        )}
      </section>
    </main>
  )
}
