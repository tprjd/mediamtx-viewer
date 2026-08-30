// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testDirectory = mkdtempSync(join(tmpdir(), 'mediamtx-channels-test-'))

process.env.AUTH_DB_PATH = join(testDirectory, 'auth.sqlite')
process.env.BETTER_AUTH_URL = 'http://localhost:3000'
process.env.BETTER_AUTH_SECRET = 'vitest-better-auth-secret-at-least-32-characters'
process.env.INTERNAL_AUTH_SECRET = 'vitest-internal-secret-at-least-32-characters'
process.env.MEDIAMTX_AUTH_SECRET = 'vitest-mediamtx-secret-at-least-32-characters'

vi.mock('server-only', () => ({}))

describe('account-owned channels', () => {
  beforeAll(async () => {
    const { getDatabase } = await import('@/lib/auth/database')
    const database = getDatabase()
    database.exec(
      'CREATE TABLE app_migration (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
    )
    for (const name of readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort()) {
      database.exec(readFileSync(join('migrations', name), 'utf8'))
    }
    const now = Date.now()
    database
      .prepare(
        `INSERT INTO user (
          id, name, email, emailVerified, createdAt, updatedAt,
          username, displayUsername, role, banned, activationStatus, activatedAt
        ) VALUES
          ('admin-id', 'Administrator', 'admin@example.com', 0, ?, ?,
           'power', 'power', 'admin', 0, 'active', ?),
          ('friend-id', 'Friend', 'friend@example.com', 0, ?, ?,
           'friend', 'friend', 'user', 0, 'active', ?),
          ('second-id', 'Second Friend', 'second@example.com', 0, ?, ?,
           'second', 'second', 'user', 0, 'active', ?)` ,
      )
      .run(now, now, now, now, now, now, now, now, now)
  })

  afterAll(async () => {
    const { getDatabase } = await import('@/lib/auth/database')
    getDatabase().close()
    rmSync(testDirectory, { recursive: true, force: true })
  })

  it('grants one stable channel to an active user', async () => {
    const { getChannels, grantStreaming } = await import('@/lib/channels')
    const channel = grantStreaming('admin-id', 'friend-id', 'friend-channel')

    expect(channel).toMatchObject({
      ownerUserId: 'friend-id',
      slug: 'friend-channel',
      mediaPath: 'channels/friend-channel',
      enabled: true,
      hasStreamKey: false,
    })
    expect(getChannels()).toHaveLength(1)
    expect(() => grantStreaming('admin-id', 'friend-id', 'another')).toThrow(
      'already owns a channel',
    )
  })

  it('authorizes a generated key only for its exact path and revokes on rotation', async () => {
    const { authorizePublish, createOrRotateStreamKey } = await import('@/lib/channels')
    const first = createOrRotateStreamKey('friend-id')

    expect(authorizePublish('channels/friend-channel', first.token)).toBe(true)
    expect(authorizePublish('channels/someone-else', first.token)).toBe(false)
    expect(authorizePublish('channels/friend-channel', 'mtx_sk_not-the-key')).toBe(false)

    const replacement = createOrRotateStreamKey('friend-id')
    expect(replacement.rotated).toBe(true)
    expect(authorizePublish('channels/friend-channel', first.token)).toBe(false)
    expect(authorizePublish('channels/friend-channel', replacement.token)).toBe(true)
  })

  it('handles MediaMTX publish callbacks without exposing the secret endpoint', async () => {
    const { createOrRotateStreamKey } = await import('@/lib/channels')
    const { POST } = await import('@/app/api/internal/mediamtx/authorize/route')
    const key = createOrRotateStreamKey('friend-id')
    const callback = (secret: string, path: string) =>
      POST(
        new Request(
          `http://localhost:3000/api/internal/mediamtx/authorize?secret=${secret}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              action: 'publish',
              path,
              token: key.token,
            }),
          },
        ),
      )

    await expect(callback('wrong-secret', 'channels/friend-channel')).resolves.toMatchObject({
      status: 404,
    })
    await expect(
      callback(process.env.MEDIAMTX_AUTH_SECRET!, 'channels/another-channel'),
    ).resolves.toMatchObject({ status: 401 })
    await expect(
      callback(process.env.MEDIAMTX_AUTH_SECRET!, 'channels/friend-channel'),
    ).resolves.toMatchObject({ status: 204 })
  })

  it('authorizes two owned channels concurrently without cross-path access', async () => {
    const { authorizePublish, createOrRotateStreamKey, grantStreaming } = await import(
      '@/lib/channels'
    )
    grantStreaming('admin-id', 'second-id', 'second-channel')
    const first = createOrRotateStreamKey('friend-id')
    const second = createOrRotateStreamKey('second-id')

    expect(authorizePublish('channels/friend-channel', first.token)).toBe(true)
    expect(authorizePublish('channels/second-channel', second.token)).toBe(true)
    expect(authorizePublish('channels/friend-channel', second.token)).toBe(false)
    expect(authorizePublish('channels/second-channel', first.token)).toBe(false)
  })

  it('disables the owned channel and its key with the account', async () => {
    const { disableUser } = await import('@/lib/auth/store')
    const { authorizePublish, createOrRotateStreamKey, getOwnedChannel } = await import(
      '@/lib/channels'
    )
    const key = createOrRotateStreamKey('friend-id')

    expect(disableUser('admin-id', 'friend-id')).toBe('channels/friend-channel')
    expect(authorizePublish('channels/friend-channel', key.token)).toBe(false)
    expect(getOwnedChannel('friend-id')).toMatchObject({
      enabled: false,
      hasStreamKey: false,
    })
  })
})
