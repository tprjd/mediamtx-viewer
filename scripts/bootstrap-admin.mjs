import Database from 'better-sqlite3'
import { hashPassword } from '@better-auth/utils/password'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

const username = process.env.ADMIN_USERNAME
const email = process.env.ADMIN_EMAIL
const password = process.env.ADMIN_PASSWORD
const name = process.env.ADMIN_NAME ?? username
const databasePath = resolve(process.env.AUTH_DB_PATH ?? '.data/auth.sqlite')

if (!username || !/^[a-zA-Z0-9_.]{3,30}$/.test(username)) {
  throw new Error('ADMIN_USERNAME must be 3-30 letters, numbers, dots, or underscores')
}
if (!email || !email.includes('@')) throw new Error('ADMIN_EMAIL is required')
if (!password || password.length < 15 || password.length > 128) {
  throw new Error('ADMIN_PASSWORD must contain between 15 and 128 characters')
}

const database = new Database(databasePath)
database.pragma('foreign_keys = ON')
const existing = database
  .prepare(
    `SELECT id, name, role, activationStatus
     FROM user WHERE username = ? OR email = ?`,
  )
  .get(username.toLowerCase(), email.toLowerCase())
if (existing) {
  if (existing.role !== 'admin' || existing.activationStatus !== 'active') {
    throw new Error('An account with this username or email already exists')
  }
  const now = Date.now()
  database
    .prepare(
      `INSERT OR IGNORE INTO channel (
        id, owner_user_id, slug, media_path, display_name, title, description,
        accent_color, preferred_playback, enabled, created_at, updated_at, created_by
      ) VALUES (?, ?, 'live', 'live', 'Main channel', 'Live stream',
                'Games and occasional broadcasts, streamed directly from home.',
                '#db2777', 'webrtc', 1, ?, ?, ?)` ,
    )
    .run(randomUUID(), existing.id, now, now, existing.id)
  database
    .prepare("UPDATE channel SET display_name = 'Main channel' WHERE owner_user_id = ? AND slug = 'live'")
    .run(existing.id)
  database.close()
  process.stdout.write(`Active administrator ${username} already exists; bootstrap skipped.\n`)
  process.exit(0)
}

const now = Date.now()
const userId = randomUUID()
const passwordHash = await hashPassword(password)

database.transaction(() => {
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
      name,
      email.toLowerCase(),
      now,
      now,
      username.toLowerCase(),
      username,
      now,
      userId,
    )
  database
    .prepare(
      `INSERT INTO account (
        id, issuer, accountId, providerId, userId, password, createdAt, updatedAt
      ) VALUES (?, 'local:credential', ?, 'credential', ?, ?, ?, ?)`,
    )
    .run(randomUUID(), userId, userId, passwordHash, now, now)
  database
    .prepare(
      `INSERT INTO auth_audit_log
        (id, actor_id, target_id, action, metadata, created_at)
       VALUES (?, ?, ?, 'bootstrap_admin', '{}', ?)`,
    )
    .run(randomUUID(), userId, userId, now)
  database
    .prepare(
      `INSERT INTO channel (
        id, owner_user_id, slug, media_path, display_name, title, description,
        accent_color, preferred_playback, enabled, created_at, updated_at, created_by
      ) VALUES (?, ?, 'live', 'live', 'Main channel', 'Live stream',
                'Games and occasional broadcasts, streamed directly from home.',
                '#db2777', 'webrtc', 1, ?, ?, ?)` ,
    )
    .run(randomUUID(), userId, now, now, userId)
})()

database.close()
process.stdout.write(`Created active administrator ${username} (${email})\n`)
