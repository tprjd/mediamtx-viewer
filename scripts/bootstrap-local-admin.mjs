import Database from 'better-sqlite3'
import { hashPassword } from '@better-auth/utils/password'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_LOCAL_ADMIN = Object.freeze({
  username: 'power',
  email: 'administrator@example.com',
  password: 'local-development-password',
})

export function localAdminFromEnvironment(environment = process.env) {
  return {
    username: environment.ADMIN_USERNAME ?? DEFAULT_LOCAL_ADMIN.username,
    email: environment.ADMIN_EMAIL ?? DEFAULT_LOCAL_ADMIN.email,
    password: environment.ADMIN_PASSWORD ?? DEFAULT_LOCAL_ADMIN.password,
  }
}

function databasePath(value) {
  return resolve(value ?? '.data/auth.sqlite')
}

function requireSingleTarget(database, admin) {
  const rows = database
    .prepare(
      `SELECT id, name, username, email, role, activationStatus
       FROM user
       WHERE lower(username) = ? OR lower(email) = ?`,
    )
    .all(admin.username.toLowerCase(), admin.email.toLowerCase())

  const ids = new Set(rows.map((row) => row.id))
  if (ids.size > 1) {
    throw new Error(
      'The local administrator username and email belong to different accounts.',
    )
  }
  return rows[0] ?? null
}

function ensureAccount(database, userId, passwordHash, now) {
  const account = database
    .prepare(
      `SELECT id FROM account
       WHERE userId = ? AND providerId = 'credential'
       ORDER BY createdAt ASC LIMIT 1`,
    )
    .get(userId)

  if (account) {
    database
      .prepare('UPDATE account SET password = ?, updatedAt = ? WHERE id = ?')
      .run(passwordHash, now, account.id)
    return
  }

  database
    .prepare(
      `INSERT INTO account
        (id, issuer, accountId, providerId, userId, password, createdAt, updatedAt)
       VALUES (?, 'local:credential', ?, 'credential', ?, ?, ?, ?)`,
    )
    .run(randomUUID(), userId, userId, passwordHash, now, now)
}

function ensureChannel(database, userId, now) {
  const conflicting = database
    .prepare(
      `SELECT owner_user_id AS ownerUserId
       FROM channel WHERE slug = 'live' OR media_path = 'live'`,
    )
    .all()
    .find((row) => row.ownerUserId !== userId)
  if (conflicting) {
    throw new Error(
      'The live channel is already owned by another account; local bootstrap did not change it.',
    )
  }

  const channel = database
    .prepare(
      `SELECT id, slug, media_path AS mediaPath FROM channel
       WHERE owner_user_id = ?
       ORDER BY created_at ASC LIMIT 1`,
    )
    .get(userId)

  if (channel) {
    if (channel.slug !== 'live' || channel.mediaPath !== 'live') {
      throw new Error(
        'The local administrator already owns another channel; local bootstrap did not change it.',
      )
    }
    database
      .prepare(
        `UPDATE channel
         SET enabled = 1, updated_at = ?
         WHERE id = ?`,
      )
      .run(now, channel.id)
    return
  }

  database
    .prepare(
      `INSERT INTO channel (
        id, owner_user_id, slug, media_path, display_name, title, description,
        accent_color, preferred_playback, enabled, created_at, updated_at, created_by,
        discord_notifications_enabled
      ) VALUES (?, ?, 'live', 'live', 'Main channel', 'Live stream',
                'Games and occasional broadcasts, streamed directly from home.',
                '#db2777', 'hls', 1, ?, ?, ?, 1)`,
    )
    .run(randomUUID(), userId, now, now, userId)
}

/**
 * Ensure the fixed local administrator exists without touching other accounts,
 * sessions, channels, or activity entries.
 */
export async function ensureLocalAdministrator({
  authDatabasePath = process.env.AUTH_DB_PATH,
  admin = localAdminFromEnvironment(),
} = {}) {
  if (!/^[a-zA-Z0-9_.]{3,30}$/.test(admin.username)) {
    throw new Error('ADMIN_USERNAME must be 3-30 letters, numbers, dots, or underscores')
  }
  if (!admin.email.includes('@')) throw new Error('ADMIN_EMAIL is required')
  if (admin.password.length < 15 || admin.password.length > 128) {
    throw new Error('ADMIN_PASSWORD must contain between 15 and 128 characters')
  }

  const database = new Database(databasePath(authDatabasePath))
  database.pragma('foreign_keys = ON')

  try {
    const passwordHash = await hashPassword(admin.password)
    const now = Date.now()
    const target = requireSingleTarget(database, admin)

    return database.transaction(() => {
      let userId = target?.id
      if (!userId) {
        userId = randomUUID()
        database
          .prepare(
            `INSERT INTO user (
              id, name, email, emailVerified, image, createdAt, updatedAt,
              username, displayUsername, role, banned, banReason, banExpires,
              activationStatus, activatedAt, activatedBy, disabledAt
            ) VALUES (?, ?, ?, 0, NULL, ?, ?, ?, ?, 'admin', 0, NULL, NULL,
                      'active', ?, ?, NULL)`,
          )
          .run(
            userId,
            admin.username,
            admin.email.toLowerCase(),
            now,
            now,
            admin.username.toLowerCase(),
            admin.username,
            now,
            userId,
          )
      } else {
        database
          .prepare(
            `UPDATE user SET
               email = ?, username = ?, displayUsername = ?, role = 'admin',
               banned = 0, banReason = NULL, banExpires = NULL,
               activationStatus = 'active', activatedAt = COALESCE(activatedAt, ?),
               activatedBy = COALESCE(activatedBy, ?), disabledAt = NULL,
               updatedAt = ?
             WHERE id = ?`,
          )
          .run(
            admin.email.toLowerCase(),
            admin.username.toLowerCase(),
            admin.username,
            now,
            userId,
            now,
            userId,
          )
      }

      ensureAccount(database, userId, passwordHash, now)
      ensureChannel(database, userId, now)
      return { userId }
    })()
  } finally {
    database.close()
  }
}

const executedPath = process.argv[1]
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  try {
    const admin = localAdminFromEnvironment()
    await ensureLocalAdministrator({ admin })
    process.stdout.write(`Local administrator ${admin.username} is ready.\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exitCode = 1
  }
}
