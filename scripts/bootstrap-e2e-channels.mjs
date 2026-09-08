import Database from 'better-sqlite3'
import { resolve } from 'node:path'

if (process.env.E2E_FIXTURES !== '1') {
  throw new Error('Set E2E_FIXTURES=1 to create browser-test Channels')
}

const databasePath = resolve(process.env.AUTH_DB_PATH ?? '.data/e2e-auth.sqlite')
const database = new Database(databasePath)
database.pragma('foreign_keys = ON')

const admin = database
  .prepare(
    "SELECT id FROM user WHERE role = 'admin' AND activationStatus = 'active' ORDER BY createdAt ASC LIMIT 1",
  )
  .get()

if (!admin) {
  database.close()
  throw new Error('Bootstrap the browser-test administrator first')
}

const fixtures = [
  {
    id: 'e2e-directory-alpha-user',
    name: 'Alpha Owner',
    email: 'alpha-owner@example.test',
    username: 'alpha_owner',
    slug: 'alpha',
    title: 'Alpha Channel',
    accentColor: '#0ea5e9',
  },
  {
    id: 'e2e-directory-zulu-user',
    name: 'Zulu Owner',
    email: 'zulu-owner@example.test',
    username: 'zulu_owner',
    slug: 'zulu',
    title: 'Zulu Channel',
    accentColor: '#f59e0b',
  },
]

const now = Date.now()
const insertUser = database.prepare(`
  INSERT OR IGNORE INTO user (
    id, name, email, emailVerified, image, createdAt, updatedAt,
    username, displayUsername, role, banned, banReason, banExpires,
    activationStatus, activatedAt, activatedBy, disabledAt
  ) VALUES (?, ?, ?, 0, NULL, ?, ?, ?, ?, 'user', 0, NULL, NULL,
            'active', ?, ?, NULL)
`)
const updateUser = database.prepare(`
  UPDATE user
  SET name = ?, updatedAt = ?, activationStatus = 'active', disabledAt = NULL
  WHERE id = ?
`)
const insertChannel = database.prepare(`
  INSERT OR IGNORE INTO channel (
    id, owner_user_id, slug, media_path, display_name, title, description,
    accent_color, preferred_playback, enabled, created_at, updated_at, created_by
  ) VALUES (?, ?, ?, ?, ?, ?, 'Browser-test directory Channel.', ?, 'webrtc',
            1, ?, ?, ?)
`)
const updateChannel = database.prepare(`
  UPDATE channel
  SET display_name = ?, title = ?, accent_color = ?, enabled = 1, updated_at = ?
  WHERE owner_user_id = ?
`)

database.transaction(() => {
  for (const [index, fixture] of fixtures.entries()) {
    insertUser.run(
      fixture.id,
      fixture.name,
      fixture.email,
      now + index,
      now + index,
      fixture.username,
      fixture.username,
      now + index,
      admin.id,
    )
    updateUser.run(fixture.name, now + index, fixture.id)
    insertChannel.run(
      `e2e-directory-${fixture.slug}-channel`,
      fixture.id,
      fixture.slug,
      `channels/${fixture.slug}`,
      fixture.title,
      fixture.title,
      fixture.accentColor,
      now + index,
      now + index,
      admin.id,
    )
    updateChannel.run(
      fixture.title,
      fixture.title,
      fixture.accentColor,
      now + index,
      fixture.id,
    )
  }
})()

database.close()
process.stdout.write('Browser-test Channels are ready.\n')
