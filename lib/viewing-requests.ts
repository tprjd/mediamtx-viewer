import 'server-only'
import { randomUUID } from 'node:crypto'
import { getDatabase } from '@/lib/auth/database'
import { recordAudit } from '@/lib/auth/store'
import { hasVerifiedOrLegacyAccountAccess, canSeeChannel, canWatchChannel, getAccountAccess } from '@/lib/viewing-access'

export interface ViewingRequest {
  id: string; viewerId: string; name: string; slug: string; status: 'pending' | 'approved' | 'rejected' | 'revoked' | 'closed'; revision: number; retryAt: number; updatedAt: number
}
export interface AccountNotification {
  id: number; title: string; body: string; readAt: number | null; createdAt: number; requestId: string | null; revision: number | null; actionable: boolean
}

export function notifyAccount(recipientId: string, title: string, body: string, requestId: string | null = null, revision: number | null = null): void {
  getDatabase().prepare(`INSERT INTO account_notification (recipient_id, title, body, request_id, request_revision, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(recipientId, title, body, requestId, revision, Date.now())
}

export function getViewingRequest(viewerId: string, slug: string): ViewingRequest | undefined {
  return getDatabase().prepare(`SELECT r.id, r.viewer_id AS viewerId, u.name, c.slug, r.status, r.revision, r.retry_at AS retryAt, r.updated_at AS updatedAt
    FROM channel_viewing_request r JOIN channel c ON c.id = r.channel_id JOIN user u ON u.id = r.viewer_id WHERE r.viewer_id = ? AND c.slug = ? COLLATE NOCASE`).get(viewerId, slug) as ViewingRequest | undefined
}

export function listViewingRequests(ownerId: string): ViewingRequest[] {
  return getDatabase().prepare(`SELECT r.id, r.viewer_id AS viewerId, u.name, c.slug, r.status, r.revision, r.retry_at AS retryAt, r.updated_at AS updatedAt
    FROM channel_viewing_request r JOIN channel c ON c.id = r.channel_id JOIN user u ON u.id = r.viewer_id WHERE c.owner_user_id = ? ORDER BY r.updated_at DESC`).all(ownerId) as ViewingRequest[]
}

export function requestViewing(viewerId: string, slug: string, now = Date.now()): void {
  const database = getDatabase()
  database.transaction(() => {
    if (!hasVerifiedOrLegacyAccountAccess(viewerId)) throw new Error('Verify your email before requesting viewing access.')
    if (!canSeeChannel(viewerId, slug)) throw new Error('Channel not found.')
    if (canWatchChannel(viewerId, slug)) return
    const existing = getViewingRequest(viewerId, slug)
    if (existing?.status === 'pending') return
    if (existing && existing.retryAt > now) throw new Error('Wait 30 minutes after the last decision before requesting again.')
    const channel = database.prepare('SELECT id, owner_user_id AS ownerId FROM channel WHERE slug = ? COLLATE NOCASE').get(slug) as { id: string; ownerId: string }
    const viewer = database.prepare('SELECT name FROM user WHERE id = ?').get(viewerId) as { name: string }
    const id = existing?.id ?? randomUUID()
    const revision = (existing?.revision ?? 0) + 1
    database.prepare(`INSERT INTO channel_viewing_request (id, channel_id, viewer_id, status, revision, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?, ?) ON CONFLICT(channel_id, viewer_id) DO UPDATE SET status = 'pending', revision = excluded.revision, retry_at = 0, updated_at = excluded.updated_at`).run(id, channel.id, viewerId, revision, now, now)
    notifyAccount(channel.ownerId, `${viewer.name} wants to watch`, 'This account has not been approved by an administrator.', id, revision)
  }).immediate()
}

export function decideViewingRequest(ownerId: string, requestId: string, revision: number, decision: 'approved' | 'rejected' | 'revoked', now = Date.now()): string {
  const database = getDatabase()
  return database.transaction(() => {
    const request = listViewingRequests(ownerId).find((entry) => entry.id === requestId)
    if (!request || getAccountAccess(ownerId)?.activationStatus !== 'active') throw new Error('Viewing request not found.')
    if (request.revision !== revision || request.status !== (decision === 'revoked' ? 'approved' : 'pending')) throw new Error('This request has changed. Refresh before making a decision.')
    database.prepare(`UPDATE channel_viewing_request SET status = ?, revision = revision + 1, retry_at = ?, updated_at = ? WHERE id = ?`).run(decision, decision === 'approved' ? 0 : now + 30 * 60_000, now, requestId)
    if (decision === 'revoked' && !canWatchChannel(request.viewerId, request.slug)) database.prepare(`INSERT INTO access_revocation (id, user_id, media_path, created_at) SELECT ?, ?, media_path, ? FROM channel WHERE slug = ?`).run(randomUUID(), request.viewerId, now, request.slug)
    notifyAccount(request.viewerId, decision === 'approved' ? 'Viewing request approved' : decision === 'rejected' ? 'Viewing request declined' : 'Channel approval removed', decision === 'approved' ? `You can watch /watch/${request.slug} and join its chat.` : `You can request /watch/${request.slug} again in 30 minutes.`)
    recordAudit(ownerId, request.viewerId, `channel_approval_${decision}`, { requestId })
    return request.viewerId
  }).immediate()
}

export function setAdministratorApproval(actorId: string, userId: string, approved: boolean): void {
  const database = getDatabase()
  database.transaction(() => {
    const actor = database.prepare("SELECT 1 FROM user WHERE id = ? AND role = 'admin' AND activationStatus = 'active'").get(actorId)
    if (!actor) throw new Error('Administrator required.')
    const previous = getAccountAccess(userId)
    if (!previous) throw new Error('Account not found.')
    if (Boolean(previous.administratorApproved) === approved) return
    database.prepare('UPDATE user SET administratorApproved = ?, updatedAt = ? WHERE id = ?').run(Number(approved), Date.now(), userId)
    if (approved) database.prepare("UPDATE channel_viewing_request SET status = 'closed', revision = revision + 1, updated_at = ? WHERE viewer_id = ? AND status = 'pending'").run(Date.now(), userId)
    if (!approved) database.prepare('INSERT INTO access_revocation (id, user_id, created_at) VALUES (?, ?, ?)').run(randomUUID(), userId, Date.now())
    notifyAccount(userId, approved ? 'Administrator approval granted' : 'Administrator approval removed', approved ? 'You can watch every channel.' : 'Your stored channel approvals still apply. Other channels require a viewing request.')
    recordAudit(actorId, userId, approved ? 'viewing_approved' : 'viewing_approval_removed')
  }).immediate()
}

export function listNotifications(userId: string, before = Number.MAX_SAFE_INTEGER) {
  const rows = getDatabase().prepare(`SELECT n.id, n.title, n.body, n.read_at AS readAt, n.created_at AS createdAt, n.request_id AS requestId, n.request_revision AS revision,
    CASE WHEN r.status = 'pending' AND r.revision = n.request_revision AND c.owner_user_id = n.recipient_id THEN 1 ELSE 0 END AS actionable
    FROM account_notification n LEFT JOIN channel_viewing_request r ON r.id = n.request_id LEFT JOIN channel c ON c.id = r.channel_id
    WHERE n.recipient_id = ? AND n.id < ? ORDER BY n.id DESC LIMIT 100`).all(userId, before) as (Omit<AccountNotification, 'actionable'> & { actionable: number })[]
  const unread = getDatabase().prepare('SELECT COUNT(*) AS count FROM account_notification WHERE recipient_id = ? AND read_at IS NULL').get(userId) as { count: number }
  return { notifications: rows.map((row) => ({ ...row, actionable: Boolean(row.actionable) })), unread: unread.count, sound: Boolean(getAccountAccess(userId)?.notificationSound) }
}

export function markNotificationsRead(userId: string, id?: number): void {
  getDatabase().prepare(`UPDATE account_notification SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL${id === undefined ? '' : ' AND id = ?'}`).run(...(id === undefined ? [Date.now(), userId] : [Date.now(), userId, id]))
}

export function setNotificationSound(userId: string, enabled: boolean): void {
  getDatabase().prepare('UPDATE user SET notificationSound = ? WHERE id = ?').run(Number(enabled), userId)
}
