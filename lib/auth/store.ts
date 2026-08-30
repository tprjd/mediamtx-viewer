import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { getDatabase } from '@/lib/auth/database'
import type {
  ActivationStatus,
  AuditEntry,
  AuthSessionView,
  AuthUser,
} from '@/lib/auth/types'

interface UserRow {
  id: string
  name: string
  email: string
  username: string | null
  role: string | null
  activationStatus: ActivationStatus
  createdAt: number
  activatedAt: number | null
  disabledAt: number | null
}

function toDate(value: number | null): Date | null {
  return value === null ? null : new Date(value)
}

function mapUser(row: UserRow): AuthUser {
  return {
    ...row,
    role: row.role ?? 'user',
    createdAt: new Date(row.createdAt),
    activatedAt: toDate(row.activatedAt),
    disabledAt: toDate(row.disabledAt),
  }
}

function recordAudit(
  actorId: string,
  targetId: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
): void {
  getDatabase()
    .prepare(
      `INSERT INTO auth_audit_log
        (id, actor_id, target_id, action, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      actorId,
      targetId,
      action,
      JSON.stringify(metadata),
      Date.now(),
    )
}

export function isDatabaseReady(): boolean {
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM sqlite_master
       WHERE type = 'table'
         AND name IN ('user', 'session', 'site_setting', 'auth_audit_log')`,
    )
    .get() as { count: number }
  return row.count === 4
}

export function getRegistrationOpen(): boolean {
  const row = getDatabase()
    .prepare("SELECT value FROM site_setting WHERE key = 'registration_open'")
    .get() as { value: string } | undefined
  return row?.value === 'true'
}

export function setRegistrationOpen(actorId: string, open: boolean): void {
  const database = getDatabase()
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO site_setting (key, value, updated_at, updated_by)
         VALUES ('registration_open', ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
      )
      .run(String(open), Date.now(), actorId)
    recordAudit(actorId, null, open ? 'registration_opened' : 'registration_closed')
  })()
}

export function listUsers(): AuthUser[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, name, email, username, role, activationStatus,
              createdAt, activatedAt, disabledAt
       FROM user
       ORDER BY
         CASE activationStatus WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
         createdAt DESC`,
    )
    .all() as UserRow[]
  return rows.map(mapUser)
}

export function getUserById(userId: string): AuthUser | null {
  const row = getDatabase()
    .prepare(
      `SELECT id, name, email, username, role, activationStatus,
              createdAt, activatedAt, disabledAt
       FROM user WHERE id = ?`,
    )
    .get(userId) as UserRow | undefined
  return row ? mapUser(row) : null
}

export function getUserStatus(userId: string): ActivationStatus | null {
  const row = getDatabase()
    .prepare('SELECT activationStatus FROM user WHERE id = ?')
    .get(userId) as { activationStatus: ActivationStatus } | undefined
  return row?.activationStatus ?? null
}

export function activateUser(actorId: string, targetId: string): void {
  const database = getDatabase()
  database.transaction(() => {
    const target = getUserById(targetId)
    if (!target) throw new Error('User not found')
    if (target.activationStatus === 'active') return

    const now = Date.now()
    database
      .prepare(
        `UPDATE user SET
           activationStatus = 'active', activatedAt = ?, activatedBy = ?,
           disabledAt = NULL, banned = 0, banReason = NULL, banExpires = NULL,
           updatedAt = ?
         WHERE id = ?`,
      )
      .run(now, actorId, now, targetId)
    recordAudit(actorId, targetId, 'activate')
  })()
}

export function countActiveAdmins(): number {
  const row = getDatabase()
    .prepare(
      "SELECT COUNT(*) AS count FROM user WHERE role = 'admin' AND activationStatus = 'active'",
    )
    .get() as { count: number }
  return row.count
}

export function disableUser(actorId: string, targetId: string): void {
  const database = getDatabase()
  database.transaction(() => {
    const target = getUserById(targetId)
    if (!target) throw new Error('User not found')
    if (target.id === actorId) throw new Error('You cannot disable your own account')
    if (target.role === 'admin' && countActiveAdmins() <= 1) {
      throw new Error('The final active administrator cannot be disabled')
    }

    const now = Date.now()
    database
      .prepare(
        `UPDATE user SET
           activationStatus = 'disabled', disabledAt = ?, banned = 1,
           banReason = 'Account disabled by an administrator', updatedAt = ?
         WHERE id = ?`,
      )
      .run(now, now, targetId)
    database.prepare('DELETE FROM session WHERE userId = ?').run(targetId)
    recordAudit(actorId, targetId, 'disable')
  })()
}

export function rejectPendingUser(actorId: string, targetId: string): void {
  const database = getDatabase()
  database.transaction(() => {
    const target = getUserById(targetId)
    if (!target) throw new Error('User not found')
    if (target.activationStatus !== 'pending') {
      throw new Error('Only pending registrations can be rejected')
    }
    if (target.id === actorId) throw new Error('You cannot delete your own account')

    recordAudit(actorId, targetId, 'reject', {
      username: target.username,
    })
    database.prepare('DELETE FROM user WHERE id = ?').run(targetId)
  })()
}

export function revokeUserSessions(actorId: string, targetId: string): number {
  const result = getDatabase().transaction(() => {
    const change = getDatabase()
      .prepare('DELETE FROM session WHERE userId = ?')
      .run(targetId)
    recordAudit(actorId, targetId, 'revoke_sessions', { count: change.changes })
    return change.changes
  })()
  return result
}

export function listUserSessions(userId: string): AuthSessionView[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, createdAt, expiresAt, userAgent
       FROM session WHERE userId = ? ORDER BY createdAt DESC`,
    )
    .all(userId) as Array<{
    id: string
    createdAt: number
    expiresAt: number
    userAgent: string | null
  }>
  return rows.map((row) => ({
    ...row,
    createdAt: new Date(row.createdAt),
    expiresAt: new Date(row.expiresAt),
  }))
}

export function revokeSession(actorId: string, sessionId: string): void {
  const database = getDatabase()
  database.transaction(() => {
    const session = database
      .prepare('SELECT userId FROM session WHERE id = ?')
      .get(sessionId) as { userId: string } | undefined
    if (!session) throw new Error('Session not found')
    database.prepare('DELETE FROM session WHERE id = ?').run(sessionId)
    recordAudit(actorId, session.userId, 'revoke_session')
  })()
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createPasswordResetToken(
  actorId: string,
  targetId: string,
): string {
  const token = randomBytes(32).toString('base64url')
  const database = getDatabase()
  database.transaction(() => {
    database.prepare('DELETE FROM auth_reset_token WHERE user_id = ?').run(targetId)
    database
      .prepare(
        `INSERT INTO auth_reset_token
          (id, token_hash, user_id, expires_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        hashResetToken(token),
        targetId,
        Date.now() + 15 * 60 * 1000,
        actorId,
        Date.now(),
      )
    recordAudit(actorId, targetId, 'create_password_reset')
  })()
  return token
}

export function consumePasswordResetToken(token: string): string | null {
  const database = getDatabase()
  return database.transaction(() => {
    const row = database
      .prepare(
        `SELECT id, user_id AS userId
         FROM auth_reset_token
         WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
      )
      .get(hashResetToken(token), Date.now()) as
      | { id: string; userId: string }
      | undefined
    if (!row) return null
    database
      .prepare('UPDATE auth_reset_token SET used_at = ? WHERE id = ?')
      .run(Date.now(), row.id)
    return row.userId
  })()
}

export function listAuditEntries(limit = 30): AuditEntry[] {
  const rows = getDatabase()
    .prepare(
      `SELECT log.id, log.action, actor.name AS actorName,
              target.name AS targetName, log.created_at AS createdAt
       FROM auth_audit_log log
       JOIN user actor ON actor.id = log.actor_id
       LEFT JOIN user target ON target.id = log.target_id
       ORDER BY log.created_at DESC LIMIT ?`,
    )
    .all(limit) as Array<Omit<AuditEntry, 'createdAt'> & { createdAt: number }>
  return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt) }))
}

