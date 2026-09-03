import 'server-only'

import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
} from 'node:crypto'

import { getDatabase } from '@/lib/auth/database'
import { authEnvironment } from '@/lib/auth/env'
import { getUserStatus, recordAudit } from '@/lib/auth/store'
import {
  createOrRotateStreamKey,
  getOwnedChannel,
  type GeneratedStreamKey,
} from '@/lib/channels'

export const OBS_SETUP_SCRIPT_VERSION = '1.4.0'
export const OBS_SETUP_EXPIRES_MS = 10 * 60 * 1000
export const OBS_SETUP_POLL_INTERVAL_SECONDS = 3
const START_LIMIT_WINDOW_MS = 10 * 60 * 1000
const START_LIMIT_PER_ADDRESS = 5
const POLL_LIMIT_PER_ADDRESS = 300
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export type ObsSetupStatus = 'pending' | 'approved' | 'denied' | 'consumed'

interface ObsSetupRow {
  id: string
  userCode: string
  status: ObsSetupStatus
  ownerUserId: string | null
  channelId: string | null
  scriptVersion: string
  expiresAt: number
  lastPolledAt: number | null
}

export interface CreatedObsSetupSession {
  deviceSecret: string
  userCode: string
  expiresAt: Date
}

export interface ObsSetupApprovalView {
  userCode: string
  status: ObsSetupStatus | 'expired'
  expiresAt: Date
}

export interface RedeemedObsSetup {
  streamKey: GeneratedStreamKey
  channelId: string
}

export class ObsSetupError extends Error {
  constructor(
    public readonly code:
      | 'invalid'
      | 'expired'
      | 'denied'
      | 'consumed'
      | 'pending'
      | 'rate_limited'
      | 'unsupported_version'
      | 'unavailable',
    message: string,
  ) {
    super(message)
    this.name = 'ObsSetupError'
  }
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export function hashObsSetupClientAddress(address: string): string {
  return createHmac('sha256', authEnvironment.internalSecret)
    .update(address || 'unknown')
    .digest('hex')
}

function generateUserCode(): string {
  let code = ''
  for (let index = 0; index < 8; index += 1) {
    code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

function cleanupObsSetupSessions(now: number): void {
  getDatabase()
    .prepare(
      `DELETE FROM obs_setup_session
       WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)`,
    )
    .run(now - 24 * 60 * 60 * 1000, now - 24 * 60 * 60 * 1000)
}

export function createObsSetupSession(
  requestIpHash: string,
  scriptVersion: string,
  now = Date.now(),
): CreatedObsSetupSession {
  if (scriptVersion !== OBS_SETUP_SCRIPT_VERSION) {
    throw new ObsSetupError(
      'unsupported_version',
      'Download the latest OBS setup script from your channel page.',
    )
  }

  const database = getDatabase()
  return database.transaction(() => {
    cleanupObsSetupSessions(now)
    const recent = database
      .prepare(
        `SELECT COUNT(*) AS count FROM obs_setup_session
         WHERE request_ip_hash = ? AND created_at >= ?`,
      )
      .get(requestIpHash, now - START_LIMIT_WINDOW_MS) as { count: number }
    if (recent.count >= START_LIMIT_PER_ADDRESS) {
      throw new ObsSetupError(
        'rate_limited',
        'Too many setup attempts. Wait a few minutes and try again.',
      )
    }

    const deviceSecret = randomBytes(32).toString('base64url')
    const expiresAt = now + OBS_SETUP_EXPIRES_MS
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const userCode = generateUserCode()
      try {
        database
          .prepare(
            `INSERT INTO obs_setup_session
              (id, device_secret_hash, user_code, request_ip_hash,
               script_version, status, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
          )
          .run(
            randomUUID(),
            hashSecret(deviceSecret),
            userCode,
            requestIpHash,
            scriptVersion,
            now,
            expiresAt,
          )
        return { deviceSecret, userCode, expiresAt: new Date(expiresAt) }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('obs_setup_session.user_code')
        ) {
          continue
        }
        throw error
      }
    }
    throw new ObsSetupError('unavailable', 'A setup code could not be created.')
  })()
}

export function enforceObsSetupPollRateLimit(
  requestIpHash: string,
  now = Date.now(),
): void {
  const database = getDatabase()
  database.transaction(() => {
    const key = `obs-setup-poll:${requestIpHash}`
    const row = database
      .prepare(
        `SELECT count, window_started_at AS windowStartedAt
         FROM obs_setup_rate_limit WHERE key = ?`,
      )
      .get(key) as { count: number; windowStartedAt: number } | undefined
    if (!row || now - row.windowStartedAt >= START_LIMIT_WINDOW_MS) {
      database
        .prepare('DELETE FROM obs_setup_rate_limit WHERE window_started_at < ?')
        .run(now - 24 * 60 * 60 * 1000)
      database
        .prepare(
          `INSERT INTO obs_setup_rate_limit (key, count, window_started_at)
           VALUES (?, 1, ?)
           ON CONFLICT(key) DO UPDATE SET count = 1,
             window_started_at = excluded.window_started_at`,
        )
        .run(key, now)
      return
    }
    if (row.count >= POLL_LIMIT_PER_ADDRESS) {
      throw new ObsSetupError(
        'rate_limited',
        'Too many setup requests. Wait a few minutes and try again.',
      )
    }
    database
      .prepare('UPDATE obs_setup_rate_limit SET count = count + 1 WHERE key = ?')
      .run(key)
  })()
}

function getSessionByUserCode(userCode: string): ObsSetupRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT id, user_code AS userCode, status,
              owner_user_id AS ownerUserId, channel_id AS channelId,
              script_version AS scriptVersion, expires_at AS expiresAt,
              last_polled_at AS lastPolledAt
       FROM obs_setup_session WHERE user_code = ? COLLATE NOCASE`,
    )
    .get(userCode) as ObsSetupRow | undefined
}

export function getObsSetupApproval(
  userCode: string,
  now = Date.now(),
): ObsSetupApprovalView | null {
  const row = getSessionByUserCode(userCode)
  if (!row) return null
  return {
    userCode: row.userCode,
    status: row.expiresAt <= now ? 'expired' : row.status,
    expiresAt: new Date(row.expiresAt),
  }
}

export function approveObsSetupSession(
  userCode: string,
  ownerUserId: string,
  now = Date.now(),
): void {
  const database = getDatabase()
  database.transaction(() => {
    const row = getSessionByUserCode(userCode)
    if (!row) throw new ObsSetupError('invalid', 'That setup code is invalid.')
    if (row.expiresAt <= now) {
      throw new ObsSetupError('expired', 'That setup code has expired.')
    }
    if (row.status !== 'pending') {
      throw new ObsSetupError(
        row.status === 'denied' ? 'denied' : 'consumed',
        'That setup code has already been used.',
      )
    }
    if (getUserStatus(ownerUserId) !== 'active') {
      throw new ObsSetupError('unavailable', 'This account is not active.')
    }
    const channel = getOwnedChannel(ownerUserId)
    if (!channel?.enabled) {
      throw new ObsSetupError('unavailable', 'Streaming is not enabled for this account.')
    }

    database
      .prepare(
        `UPDATE obs_setup_session SET status = 'approved', owner_user_id = ?,
           channel_id = ?, approved_at = ? WHERE id = ? AND status = 'pending'`,
      )
      .run(ownerUserId, channel.id, now, row.id)
    recordAudit(ownerUserId, ownerUserId, 'obs_setup_approved', {
      channelId: channel.id,
    })
  })()
}

export function denyObsSetupSession(
  userCode: string,
  ownerUserId: string,
  now = Date.now(),
): void {
  const database = getDatabase()
  database.transaction(() => {
    const row = getSessionByUserCode(userCode)
    if (!row || row.expiresAt <= now || row.status !== 'pending') {
      throw new ObsSetupError('invalid', 'That setup code is no longer available.')
    }
    database
      .prepare(
        `UPDATE obs_setup_session SET status = 'denied', owner_user_id = ?,
           approved_at = ? WHERE id = ? AND status = 'pending'`,
      )
      .run(ownerUserId, now, row.id)
    recordAudit(ownerUserId, ownerUserId, 'obs_setup_denied')
  })()
}

export function redeemObsSetupSession(
  deviceSecret: string,
  now = Date.now(),
): RedeemedObsSetup {
  const database = getDatabase()
  return database.transaction(() => {
    const row = database
      .prepare(
        `SELECT id, user_code AS userCode, status,
                owner_user_id AS ownerUserId, channel_id AS channelId,
                script_version AS scriptVersion, expires_at AS expiresAt,
                last_polled_at AS lastPolledAt
         FROM obs_setup_session WHERE device_secret_hash = ?`,
      )
      .get(hashSecret(deviceSecret)) as ObsSetupRow | undefined
    if (!row) throw new ObsSetupError('invalid', 'The OBS setup session is invalid.')
    if (row.expiresAt <= now) {
      throw new ObsSetupError('expired', 'The OBS setup session expired.')
    }
    if (row.status === 'pending') {
      if (
        row.lastPolledAt !== null &&
        now - row.lastPolledAt < (OBS_SETUP_POLL_INTERVAL_SECONDS - 1) * 1000
      ) {
        throw new ObsSetupError('rate_limited', 'Wait before polling again.')
      }
      database
        .prepare(
          `UPDATE obs_setup_session SET last_polled_at = ?,
             poll_count = poll_count + 1 WHERE id = ?`,
        )
        .run(now, row.id)
      throw new ObsSetupError('pending', 'Waiting for browser authorization.')
    }
    if (row.status === 'denied') {
      throw new ObsSetupError('denied', 'OBS setup was denied in the browser.')
    }
    if (row.status === 'consumed') {
      throw new ObsSetupError('consumed', 'The OBS setup session was already used.')
    }
    if (!row.ownerUserId || !row.channelId) {
      throw new ObsSetupError('invalid', 'The OBS setup session is incomplete.')
    }
    if (getUserStatus(row.ownerUserId) !== 'active') {
      throw new ObsSetupError('unavailable', 'The account is no longer active.')
    }
    const channel = getOwnedChannel(row.ownerUserId)
    if (!channel?.enabled || channel.id !== row.channelId) {
      throw new ObsSetupError('unavailable', 'The channel is no longer available.')
    }

    const streamKey = createOrRotateStreamKey(row.ownerUserId)
    database
      .prepare(
        `UPDATE obs_setup_session SET status = 'consumed', consumed_at = ?,
           last_polled_at = ?, poll_count = poll_count + 1
         WHERE id = ? AND status = 'approved'`,
      )
      .run(now, now, row.id)
    recordAudit(row.ownerUserId, row.ownerUserId, 'obs_setup_redeemed', {
      channelId: row.channelId,
    })
    return { streamKey, channelId: row.channelId }
  })()
}
