import { Clock3, KeyRound, ShieldCheck, UserCheck, UserX } from 'lucide-react'

import {
  activateAction,
  disableAction,
  registrationAction,
  rejectAction,
  resetLinkAction,
  revokeAllSessionsAction,
  revokeSessionAction,
} from '@/app/admin/users/actions'
import { Button } from '@/components/ui/button'
import { requireAdminSession } from '@/lib/auth/session'
import {
  getRegistrationOpen,
  listAuditEntries,
  listUsers,
  listUserSessions,
} from '@/lib/auth/store'
import type { AuthUser } from '@/lib/auth/types'

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

function UserCard({ user, currentUserId }: { user: AuthUser; currentUserId: string }) {
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
            <label className="checkbox-label">
              <input name="disconnect" type="checkbox" value="true" />
              Disconnect all current WebRTC viewers
            </label>
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
    </article>
  )
}

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const [session, params] = await Promise.all([requireAdminSession(), searchParams])
  const users = listUsers()
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
                <UserCard currentUserId={session.user.id} key={user.id} user={user} />
              ))
            ) : (
              <p className="empty-state">No {status} accounts.</p>
            )}
          </div>
        </section>
      ))}

      <section className="audit-section">
        <div className="user-group-heading">
          <ShieldCheck />
          <h2>Recent activity</h2>
        </div>
        <div className="audit-list">
          {auditEntries.map((entry) => (
            <p key={entry.id}>
              <strong>{entry.actorName}</strong> {entry.action.replaceAll('_', ' ')}
              {entry.targetName ? ` · ${entry.targetName}` : ''}
              <time>{formatDate(entry.createdAt)}</time>
            </p>
          ))}
        </div>
      </section>
    </main>
  )
}

