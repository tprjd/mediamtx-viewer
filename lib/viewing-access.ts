import 'server-only'
import { monitorDatabase } from '@/lib/database-monitoring'
import { isWhipPilotChannel } from '@/lib/whip-pilot'
import { getDatabase } from '@/lib/auth/database'

export interface AccountAccess {
  id: string
  emailVerified: number
  legacyAccess: number
  administratorApproved: number
  notificationSound: number
  activationStatus: string
}

export function getAccountAccess(userId: string): AccountAccess | undefined {
  return monitorDatabase('account_access', () => getDatabase().prepare(`SELECT id, emailVerified, legacyAccess, administratorApproved, notificationSound, activationStatus FROM user WHERE id = ?`).get(userId) as AccountAccess | undefined)
}

export function hasVerifiedOrLegacyAccountAccess(userId: string): boolean {
  const account = getAccountAccess(userId)
  return Boolean(account && account.activationStatus === 'active' && (account.emailVerified || account.legacyAccess))
}

export function canWatchChannel(userId: string, slug: string): boolean {
  return monitorDatabase('channel_watch_access', () => Boolean(getDatabase().prepare(`
    SELECT 1 FROM channel c JOIN user owner ON owner.id = c.owner_user_id
    JOIN user viewer ON viewer.id = ?
    WHERE c.slug = ? COLLATE NOCASE AND viewer.activationStatus = 'active'
      AND owner.activationStatus = 'active'
      AND (c.owner_user_id = viewer.id OR (c.enabled = 1 AND (owner.emailVerified = 1 OR owner.legacyAccess = 1)
        AND (viewer.administratorApproved = 1 OR EXISTS (
          SELECT 1 FROM channel_viewing_request r WHERE r.channel_id = c.id AND r.viewer_id = viewer.id AND r.status = 'approved'
        ))))
  `).get(userId, slug)))
}

export function canSeeChannel(userId: string, slug: string): boolean {
  return Boolean(getDatabase().prepare(`SELECT 1 FROM channel c JOIN user u ON u.id = c.owner_user_id
    WHERE c.slug = ? COLLATE NOCASE AND EXISTS (SELECT 1 FROM user viewer WHERE viewer.id = ? AND viewer.activationStatus = 'active') AND u.activationStatus = 'active'
    AND (c.owner_user_id = ? OR (c.enabled = 1 AND (u.emailVerified = 1 OR u.legacyAccess = 1)))`).get(slug, userId, userId))
}

/** The directory is present only when one Channel owns the HLS media scope. */
export function checkMediaPath(userId: string, uri: string): { allowed: boolean; hlsDirectory?: string } {
  let path: string
  try { path = decodeURIComponent(new URL(uri, 'http://internal').pathname) } catch { return { allowed: false } }
  const prefix = ['/media/hls/', '/media/whep/', '/publish/whep/'].find((value) => path.startsWith(value))
  if (!prefix) return { allowed: true }
  if (path.includes('\\') || path.split('/').some((part) => part === '.' || part === '..')) return { allowed: false }
  let media = path.slice(prefix.length)
  const derivative = media.startsWith('_hls/')
  if (derivative) {
    if (prefix !== '/media/hls/') return { allowed: false }
    media = media.slice('_hls/'.length)
  }
  const channels = getDatabase().prepare('SELECT slug, media_path AS mediaPath FROM channel').all() as { slug: string; mediaPath: string }[]
  const [channel, overlap] = channels.filter((entry) => media.startsWith(`${entry.mediaPath}/`))
  if (!channel || (derivative && !isWhipPilotChannel(channel.slug)) || !canWatchChannel(userId, channel.slug)) return { allowed: false }
  if (overlap || prefix !== '/media/hls/') return { allowed: true }
  if (!derivative) return { allowed: true, hlsDirectory: prefix + channel.mediaPath }
  const generation = media.slice(channel.mediaPath.length + 1).split('/', 1)[0]
  return /^[a-zA-Z0-9_-]+$/.test(generation)
    ? { allowed: true, hlsDirectory: `${prefix}_hls/${channel.mediaPath}/${generation}` }
    : { allowed: true }
}

export function canRequestMedia(userId: string, uri: string): boolean {
  return checkMediaPath(userId, uri).allowed
}
