import 'server-only'

import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { getDatabase } from '@/lib/auth/database'
import { recordAudit } from '@/lib/auth/store'
import {
  channelMetadataSchema,
  channelSchema,
  channelSlugSchema,
  type Channel,
  type ChannelMetadata,
} from '@/lib/channel-schema'

interface ChannelRow {
  id: string
  ownerUserId: string
  slug: string
  mediaPath: string
  displayName: string
  title: string
  description: string | null
  accentColor: string
  preferredPlayback: 'hls' | 'webrtc'
  enabled: number
  createdAt: number
  updatedAt: number
  ownerName?: string
  ownerUsername?: string | null
  ownerStatus?: string
  tokenHint?: string | null
}

export interface OwnedChannel extends Channel {
  id: string
  ownerUserId: string
  enabled: boolean
  hasStreamKey: boolean
  streamKeyHint: string | null
  createdAt: Date
  updatedAt: Date
}

export interface AdminChannel extends OwnedChannel {
  ownerName: string
  ownerUsername: string | null
  ownerStatus: string
}

export interface GeneratedStreamKey {
  token: string
  hint: string
  mediaPath: string
  rotated: boolean
}

function toChannel(row: ChannelRow): Channel {
  return channelSchema.parse({
    slug: row.slug,
    mediaPath: row.mediaPath,
    displayName: row.displayName,
    title: row.title,
    description: row.description ?? undefined,
    accentColor: row.accentColor,
    preferredPlayback: row.preferredPlayback,
  })
}

function toOwnedChannel(row: ChannelRow): OwnedChannel {
  return {
    ...toChannel(row),
    id: row.id,
    ownerUserId: row.ownerUserId,
    enabled: row.enabled === 1,
    hasStreamKey: Boolean(row.tokenHint),
    streamKeyHint: row.tokenHint ?? null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  }
}

const publicColumns = `
  channel.id, channel.owner_user_id AS ownerUserId, channel.slug,
  channel.media_path AS mediaPath, channel.display_name AS displayName,
  channel.title, channel.description, channel.accent_color AS accentColor,
  channel.preferred_playback AS preferredPlayback, channel.enabled,
  channel.created_at AS createdAt, channel.updated_at AS updatedAt,
  channel_stream_key.token_hint AS tokenHint`

export function getChannels(): Channel[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${publicColumns}
       FROM channel
       JOIN user ON user.id = channel.owner_user_id
       LEFT JOIN channel_stream_key ON channel_stream_key.channel_id = channel.id
       WHERE channel.enabled = 1 AND user.activationStatus = 'active'
       ORDER BY channel.created_at ASC`,
    )
    .all() as ChannelRow[]
  return rows.map(toChannel)
}

export function getChannel(slug: string): Channel | undefined {
  const parsed = channelSlugSchema.safeParse(slug)
  if (!parsed.success) return undefined
  const row = getDatabase()
    .prepare(
      `SELECT ${publicColumns}
       FROM channel
       JOIN user ON user.id = channel.owner_user_id
       LEFT JOIN channel_stream_key ON channel_stream_key.channel_id = channel.id
       WHERE channel.slug = ? COLLATE NOCASE
         AND channel.enabled = 1
         AND user.activationStatus = 'active'`,
    )
    .get(parsed.data) as ChannelRow | undefined
  return row ? toChannel(row) : undefined
}

export function getOwnedChannel(ownerUserId: string): OwnedChannel | null {
  const row = getDatabase()
    .prepare(
      `SELECT ${publicColumns}
       FROM channel
       LEFT JOIN channel_stream_key ON channel_stream_key.channel_id = channel.id
       WHERE channel.owner_user_id = ?`,
    )
    .get(ownerUserId) as ChannelRow | undefined
  return row ? toOwnedChannel(row) : null
}

export function listAdminChannels(): AdminChannel[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${publicColumns}, user.name AS ownerName,
              user.username AS ownerUsername, user.activationStatus AS ownerStatus
       FROM channel
       JOIN user ON user.id = channel.owner_user_id
       LEFT JOIN channel_stream_key ON channel_stream_key.channel_id = channel.id
       ORDER BY channel.created_at ASC`,
    )
    .all() as ChannelRow[]
  return rows.map((row) => ({
    ...toOwnedChannel(row),
    ownerName: row.ownerName ?? '',
    ownerUsername: row.ownerUsername ?? null,
    ownerStatus: row.ownerStatus ?? 'disabled',
  }))
}

export function grantStreaming(
  actorId: string,
  targetUserId: string,
  rawSlug: string,
): OwnedChannel {
  const slug = channelSlugSchema.parse(rawSlug)
  const database = getDatabase()
  return database.transaction(() => {
    const target = database
      .prepare('SELECT name, activationStatus FROM user WHERE id = ?')
      .get(targetUserId) as { name: string; activationStatus: string } | undefined
    if (!target) throw new Error('User not found')
    if (target.activationStatus !== 'active') {
      throw new Error('Only active accounts can receive a channel')
    }
    if (
      database.prepare('SELECT 1 FROM channel WHERE owner_user_id = ?').get(targetUserId)
    ) {
      throw new Error('This account already owns a channel')
    }

    const now = Date.now()
    const id = randomUUID()
    try {
      database
        .prepare(
          `INSERT INTO channel (
            id, owner_user_id, slug, media_path, display_name, title,
            description, accent_color, preferred_playback, enabled,
            created_at, updated_at, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, '#8b5cf6', 'webrtc', 1, ?, ?, ?)`,
        )
        .run(
          id,
          targetUserId,
          slug,
          `channels/${slug}`,
          target.name,
          `${target.name}'s stream`,
          now,
          now,
          actorId,
        )
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new Error('That channel slug is already in use')
      }
      throw error
    }
    recordAudit(actorId, targetUserId, 'streaming_granted', { channelId: id, slug })
    const channel = getOwnedChannel(targetUserId)
    if (!channel) throw new Error('Channel creation failed')
    return channel
  })()
}

export function setChannelEnabled(
  actorId: string,
  targetUserId: string,
  enabled: boolean,
): string {
  const database = getDatabase()
  return database.transaction(() => {
    const row = database
      .prepare(
        `SELECT channel.id, channel.media_path AS mediaPath, user.activationStatus
         FROM channel JOIN user ON user.id = channel.owner_user_id
         WHERE channel.owner_user_id = ?`,
      )
      .get(targetUserId) as
      | { id: string; mediaPath: string; activationStatus: string }
      | undefined
    if (!row) throw new Error('Channel not found')
    if (enabled && row.activationStatus !== 'active') {
      throw new Error('Activate the account before enabling its channel')
    }
    database
      .prepare('UPDATE channel SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, Date.now(), row.id)
    if (!enabled) {
      database.prepare('DELETE FROM channel_stream_key WHERE channel_id = ?').run(row.id)
    }
    recordAudit(
      actorId,
      targetUserId,
      enabled ? 'streaming_enabled' : 'streaming_disabled',
      { channelId: row.id },
    )
    return row.mediaPath
  })()
}

export function updateOwnedChannelMetadata(
  ownerUserId: string,
  rawMetadata: ChannelMetadata,
): void {
  const metadata = channelMetadataSchema.parse(rawMetadata)
  const database = getDatabase()
  database.transaction(() => {
    const row = database
      .prepare(
        `SELECT channel.id FROM channel
         JOIN user ON user.id = channel.owner_user_id
         WHERE channel.owner_user_id = ? AND user.activationStatus = 'active'`,
      )
      .get(ownerUserId) as { id: string } | undefined
    if (!row) throw new Error('You do not have a channel')
    database
      .prepare(
        'UPDATE channel SET title = ?, description = ?, updated_at = ? WHERE id = ?',
      )
      .run(metadata.title, metadata.description || null, Date.now(), row.id)
    recordAudit(ownerUserId, ownerUserId, 'channel_metadata_updated', {
      channelId: row.id,
    })
  })()
}

function hashStreamKey(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createOrRotateStreamKey(ownerUserId: string): GeneratedStreamKey {
  const database = getDatabase()
  return database.transaction(() => {
    const row = database
      .prepare(
        `SELECT channel.id, channel.media_path AS mediaPath,
                channel.enabled, user.activationStatus,
                channel_stream_key.channel_id AS existingKey
         FROM channel
         JOIN user ON user.id = channel.owner_user_id
         LEFT JOIN channel_stream_key ON channel_stream_key.channel_id = channel.id
         WHERE channel.owner_user_id = ?`,
      )
      .get(ownerUserId) as
      | {
          id: string
          mediaPath: string
          enabled: number
          activationStatus: string
          existingKey: string | null
        }
      | undefined
    if (!row) throw new Error('You do not have a channel')
    if (row.activationStatus !== 'active' || row.enabled !== 1) {
      throw new Error('Streaming is currently disabled')
    }

    const token = `mtx_sk_${randomBytes(32).toString('base64url')}`
    const hint = token.slice(-6)
    const now = Date.now()
    database
      .prepare(
        `INSERT INTO channel_stream_key
          (channel_id, token_hash, token_hint, created_at, rotated_at)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(channel_id) DO UPDATE SET
           token_hash = excluded.token_hash,
           token_hint = excluded.token_hint,
           rotated_at = excluded.created_at`,
      )
      .run(row.id, hashStreamKey(token), hint, now)
    recordAudit(
      ownerUserId,
      ownerUserId,
      row.existingKey ? 'stream_key_rotated' : 'stream_key_created',
      { channelId: row.id },
    )
    return { token, hint, mediaPath: row.mediaPath, rotated: Boolean(row.existingKey) }
  })()
}

export function authorizePublish(mediaPath: string, token: string): boolean {
  if (!token.startsWith('mtx_sk_') || token.length < 48) return false
  const row = getDatabase()
    .prepare(
      `SELECT channel.media_path AS mediaPath
       FROM channel_stream_key
       JOIN channel ON channel.id = channel_stream_key.channel_id
       JOIN user ON user.id = channel.owner_user_id
       WHERE channel_stream_key.token_hash = ?
         AND channel.enabled = 1
         AND user.activationStatus = 'active'`,
    )
    .get(hashStreamKey(token)) as { mediaPath: string } | undefined
  return row?.mediaPath === mediaPath
}
