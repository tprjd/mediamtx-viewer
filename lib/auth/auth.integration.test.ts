// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testDirectory = mkdtempSync(join(tmpdir(), 'mediamtx-auth-test-'))
const databasePath = join(testDirectory, 'auth.sqlite')

process.env.AUTH_DB_PATH = databasePath
process.env.BETTER_AUTH_URL = 'http://localhost:3000'
process.env.BETTER_AUTH_SECRET = 'vitest-better-auth-secret-at-least-32-characters'
process.env.INTERNAL_AUTH_SECRET = 'vitest-internal-secret-at-least-32-characters'

describe('account approval authentication', () => {
  beforeAll(async () => {
    const { getDatabase } = await import('@/lib/auth/database')
    const database = getDatabase()
    database.exec(
      'CREATE TABLE app_migration (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
    )
    for (const name of readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort()) {
      database.exec(readFileSync(join('migrations', name), 'utf8'))
      database
        .prepare('INSERT INTO app_migration (name, applied_at) VALUES (?, ?)')
        .run(name, Date.now())
    }
    database
      .prepare(
        `INSERT INTO user (
          id, name, email, emailVerified, createdAt, updatedAt,
          username, displayUsername, role, banned, activationStatus, activatedAt
        ) VALUES ('admin-id', 'Administrator', 'admin@example.com', 0, ?, ?,
                  'power', 'power', 'admin', 0, 'active', ?)`,
      )
      .run(Date.now(), Date.now(), Date.now())
  })

  afterAll(async () => {
    const { getDatabase } = await import('@/lib/auth/database')
    getDatabase().close()
    rmSync(testDirectory, { recursive: true, force: true })
  })

  it('keeps registration closed until an administrator opens it', async () => {
    const { auth } = await import('@/lib/auth/auth')
    const closedResponse = await auth.handler(
      new Request('http://localhost:3000/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
          name: 'Friend',
          username: 'friend_one',
          email: 'friend@example.com',
          password: 'a sufficiently long password',
        }),
      }),
    )
    expect(closedResponse.status).toBe(403)
    expect(await closedResponse.json()).toMatchObject({ code: 'REGISTRATION_CLOSED' })

    const { setRegistrationOpen } = await import('@/lib/auth/store')
    setRegistrationOpen('admin-id', true)

    const response = await auth.handler(
      new Request('http://localhost:3000/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
          name: 'Friend',
          username: 'friend_one',
          email: 'friend@example.com',
          password: 'a sufficiently long password',
        }),
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      token: null,
      user: { username: 'friend_one', activationStatus: 'pending' },
    })
  })

  it('rejects pending login, then accepts activation and revokes on disable', async () => {
    const { auth } = await import('@/lib/auth/auth')
    const loginRequest = () =>
      new Request('http://localhost:3000/api/auth/sign-in/username', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
          username: 'friend_one',
          password: 'a sufficiently long password',
        }),
      })

    const pendingResponse = await auth.handler(loginRequest())
    expect(pendingResponse.status).toBe(403)
    expect(await pendingResponse.json()).toMatchObject({ code: 'ACCOUNT_PENDING' })

    const { activateUser, disableUser, getUserById } = await import('@/lib/auth/store')
    const { getDatabase } = await import('@/lib/auth/database')
    const friend = getDatabase()
      .prepare("SELECT id FROM user WHERE username = 'friend_one'")
      .get() as { id: string }
    activateUser('admin-id', friend.id)
    expect(getUserById(friend.id)?.activationStatus).toBe('active')

    const activeResponse = await auth.handler(loginRequest())
    expect(activeResponse.status).toBe(200)
    expect(activeResponse.headers.get('set-cookie')).toContain('better-auth.session_token')
    expect(
      getDatabase().prepare('SELECT COUNT(*) AS count FROM session WHERE userId = ?').get(friend.id),
    ).toMatchObject({ count: 1 })

    disableUser('admin-id', friend.id)
    expect(getUserById(friend.id)?.activationStatus).toBe('disabled')
    expect(
      getDatabase().prepare('SELECT COUNT(*) AS count FROM session WHERE userId = ?').get(friend.id),
    ).toMatchObject({ count: 0 })
  })

  it('prevents an administrator from disabling their own account', async () => {
    const { disableUser } = await import('@/lib/auth/store')
    expect(() => disableUser('admin-id', 'admin-id')).toThrow(
      'You cannot disable your own account',
    )
  })

  it('updates and audits a profile name', async () => {
    const { getDatabase } = await import('@/lib/auth/database')
    const { getUserById, updateUserName } = await import('@/lib/auth/store')

    expect(updateUserName('admin-id', '  David  ')).toBe('David')
    expect(getUserById('admin-id')?.name).toBe('David')
    expect(
      getDatabase()
        .prepare(
          `SELECT action, actor_id AS actorId, target_id AS targetId
           FROM auth_audit_log WHERE action = 'profile_name_updated'`,
        )
        .get(),
    ).toMatchObject({
      action: 'profile_name_updated',
      actorId: 'admin-id',
      targetId: 'admin-id',
    })
  })
})
