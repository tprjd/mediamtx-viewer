import 'server-only'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { getDatabase } from '@/lib/auth/database'
import { recordAudit } from '@/lib/auth/store'
import { getOwnedChannel } from '@/lib/channels'
import { hasVerifiedOrLegacyAccountAccess } from '@/lib/viewing-access'

export class RelayError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export interface RelayRegistration {
  channelSlug: string
  mediaPath: string
  generation: string
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const activeChannel = `FROM channel_relay r JOIN channel c ON c.id = r.channel_id
  JOIN user u ON u.id = c.owner_user_id WHERE c.enabled = 1 AND u.activationStatus = 'active'
  AND (u.emailVerified = 1 OR u.legacyAccess = 1)`
const registration = `SELECT c.slug AS channelSlug, c.media_path AS mediaPath, r.generation
  ${activeChannel} AND r.credential_hash IS NOT NULL`

function queueSourceRevocation(channelId: string) {
  getDatabase().prepare(`INSERT OR IGNORE INTO relay_source_revocation (generation,media_path,created_at)
    SELECT r.generation, c.media_path, ? FROM channel_relay r JOIN channel c ON c.id = r.channel_id
    WHERE r.channel_id = ? AND r.generation IS NOT NULL`).run(Date.now(), channelId)
}

export function pendingRelaySourceRevocations(): {generation: string; mediaPath: string}[] {
  return getDatabase().prepare(`SELECT generation, media_path AS mediaPath FROM relay_source_revocation
    ORDER BY created_at, generation LIMIT 20`).all() as {generation: string; mediaPath: string}[]
}

export function completeRelaySourceRevocation(generation: string): void {
  getDatabase().prepare('DELETE FROM relay_source_revocation WHERE generation = ?').run(generation)
}

export function issueRelayPairingTicket(ownerUserId: string): string {
  const channel = getOwnedChannel(ownerUserId)
  if (!channel?.enabled || !hasVerifiedOrLegacyAccountAccess(ownerUserId)) {
    throw new RelayError(403, 'An enabled channel with streaming access is required.')
  }
  const ticket = 'mtx_rp_' + randomBytes(32).toString('base64url')
  getDatabase().prepare(`INSERT INTO channel_relay (channel_id, ticket_hash, ticket_expires_at)
    VALUES (?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET
    ticket_hash = excluded.ticket_hash, ticket_expires_at = excluded.ticket_expires_at`)
    .run(channel.id, hash(ticket), Date.now() + 10 * 60_000)
  return ticket
}

export function redeemRelayPairingTicket(ticket: string) {
  if (!/^mtx_rp_[A-Za-z0-9_-]{43}$/.test(ticket)) throw new RelayError(401, 'Invalid pairing ticket.')
  const db = getDatabase()
  return db.transaction(() => {
    const row = db.prepare(`SELECT c.id, c.slug AS channelSlug, c.media_path AS mediaPath,
      c.owner_user_id AS ownerId ${activeChannel} AND r.ticket_hash = ? AND r.ticket_expires_at > ?`)
      .get(hash(ticket), Date.now()) as {id: string; channelSlug: string; mediaPath: string; ownerId: string} | undefined
    if (!row) throw new RelayError(401, 'Invalid or expired pairing ticket.')
    const credential = 'mtx_rc_' + randomBytes(32).toString('base64url')
    queueSourceRevocation(row.id)
    db.prepare(`UPDATE channel_relay SET ticket_hash = NULL, ticket_expires_at = NULL,
      credential_hash = ?, generation = ? WHERE channel_id = ?`).run(hash(credential), randomUUID(), row.id)
    recordAudit(row.ownerId, row.ownerId, 'channel_relay_paired', { channelId: row.id })
    return { credential, channelSlug: row.channelSlug, mediaPath: row.mediaPath }
  }).immediate()
}

export function getRelayCredential(credential: string): RelayRegistration | null {
  if (!/^mtx_rc_[A-Za-z0-9_-]{43}$/.test(credential)) return null
  return (getDatabase().prepare(`${registration} AND r.credential_hash = ?`)
    .get(hash(credential)) as RelayRegistration | undefined) ?? null
}

export function getRegisteredRelay(mediaPath: string): RelayRegistration | null {
  return (getDatabase().prepare(`${registration} AND c.media_path = ?`)
    .get(mediaPath) as RelayRegistration | undefined) ?? null
}

export function getPairedRelayPaths(): Set<string> {
  const rows = getDatabase().prepare(`SELECT c.media_path AS path ${activeChannel} AND r.credential_hash IS NOT NULL`).all() as {path: string}[]
  return new Set(rows.map(row => row.path))
}

export function getRelayCredentialStatus(ownerUserId: string): boolean {
  return Boolean(getDatabase().prepare(`${registration} AND c.owner_user_id = ?`).get(ownerUserId))
}

export function revokeRelayCredential(ownerUserId: string): void {
  const db = getDatabase()
  db.transaction(() => {
    const channel = getOwnedChannel(ownerUserId)
    if (!channel) throw new RelayError(404, 'Channel not found.')
    queueSourceRevocation(channel.id)
    const result = db.prepare('DELETE FROM channel_relay WHERE channel_id = ?').run(channel.id)
    if (result.changes) recordAudit(ownerUserId, ownerUserId, 'channel_relay_revoked', { channelId: channel.id })
  }).immediate()
}
