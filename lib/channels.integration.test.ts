// @vitest-environment node

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testDirectory = mkdtempSync(join(tmpdir(), 'mediamtx-channels-test-'))

process.env.AUTH_DB_PATH = join(testDirectory, 'auth.sqlite')
process.env.THUMBNAIL_DIR = join(testDirectory, 'thumbnails')
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

  afterEach(() => vi.restoreAllMocks())

  it('reads an empty directory without contacting MediaMTX', async () => {
    const { getPublicChannels, loadChannelLiveUpdates } = await import(
      '@/lib/channel-reads'
    )
    const fetcher = vi.spyOn(globalThis, 'fetch')

    await expect(getPublicChannels()).resolves.toEqual([])
    await expect(loadChannelLiveUpdates()).resolves.toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('grants one stable channel to an active user', async () => {
    const { getChannels, grantStreaming } = await import('@/lib/channels')
    const channel = grantStreaming('admin-id', 'friend-id', 'friend-channel')

    expect(channel).toMatchObject({
      ownerUserId: 'friend-id',
      ownerName: 'Friend',
      slug: 'friend-channel',
      mediaPath: 'channels/friend-channel',
      preferredPlayback: 'hls',
      enabled: true,
      hasStreamKey: false,
    })
    expect(getChannels()).toHaveLength(1)
    expect(() => grantStreaming('admin-id', 'friend-id', 'another')).toThrow(
      'already owns a channel',
    )
  })

  it('serves a channel thumbnail with private revalidation', async () => {
    const thumbnailDirectory = process.env.THUMBNAIL_DIR!
    mkdirSync(thumbnailDirectory, { recursive: true })
    writeFileSync(
      join(thumbnailDirectory, 'channels%2Ffriend-channel.jpg'),
      Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    )
    const { GET } = await import(
      '@/app/api/channels/[slug]/thumbnail/route'
    )
    const context = { params: Promise.resolve({ slug: 'friend-channel' }) }
    const response = await GET(
      new Request('http://localhost/api/channels/friend-channel/thumbnail'),
      context,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toContain('private')
    const etag = response.headers.get('etag')
    expect(etag).toBeTruthy()

    const revalidated = await GET(
      new Request('http://localhost/api/channels/friend-channel/thumbnail', {
        headers: { 'if-none-match': etag! },
      }),
      context,
    )
    expect(revalidated.status).toBe(304)
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

  it('allows private MediaMTX health and metrics probes but not pprof', async () => {
    const { POST } = await import('@/app/api/internal/mediamtx/authorize/route')
    const callback = (action: 'api' | 'metrics' | 'pprof') =>
      POST(
        new Request(
          `http://localhost:3000/api/internal/mediamtx/authorize?secret=${process.env.MEDIAMTX_AUTH_SECRET}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action, path: '', token: '' }),
          },
        ),
      )

    await expect(callback('api')).resolves.toMatchObject({ status: 204 })
    await expect(callback('metrics')).resolves.toMatchObject({ status: 204 })
    await expect(callback('pprof')).resolves.toMatchObject({ status: 403 })
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

  it('assembles fresh public and event reads with status and poster rules', async () => {
    const { getPublicChannels, loadChannelLiveUpdates } = await import(
      '@/lib/channel-reads'
    )
    const { GET } = await import('@/app/api/channels/route')
    const fetcher = vi.spyOn(globalThis, 'fetch')

    for (const state of ['live', 'offline', 'unavailable'] as const) {
      fetcher.mockImplementation(async () =>
        state === 'unavailable'
          ? new Response(null, { status: 503 })
          : Response.json({
              items: state === 'live'
                ? [{ name: 'channels/friend-channel', ready: true, tracks: ['H264'] }]
                : [],
            }),
      )
      const channels = await getPublicChannels()
      const updates = await loadChannelLiveUpdates()
      const poster = state === 'live'
        ? expect.stringMatching(/^\/api\/channels\/friend-channel\/thumbnail\?v=\d+$/)
        : undefined
      const status = {
        state,
        live: state === 'live',
        startedAt: null,
        tracks: state === 'live' ? ['H264'] : [],
        viewerCount: state === 'offline' ? 0 : null,
        checkedAt: expect.any(String),
      }

      expect(channels.map(({ slug }) => slug)).toEqual(['friend-channel', 'second-channel'])
      expect(channels[0]).toEqual({
        slug: 'friend-channel',
        ownerName: 'Friend',
        title: "Friend's stream",
        description: undefined,
        accentColor: '#db2777',
        preferredPlayback: 'hls',
        hasCompatibilityFallback: false,
        playback: {
          hls: '/media/hls/channels/friend-channel/index.m3u8?cookieCheck=1',
          webrtc: '/media/whep/channels/friend-channel/whep',
          fallbackHls: undefined,
        },
        status,
        poster,
      })
      expect(updates[0]).toEqual({
        slug: 'friend-channel',
        ownerName: 'Friend',
        title: "Friend's stream",
        discordNotificationsEnabled: true,
        status,
        poster: poster ?? null,
      })
      expect(updates.map(({ slug }) => slug)).toEqual(['friend-channel', 'second-channel'])
      expect(channels[1]).toMatchObject({
        status: { state: state === 'unavailable' ? 'unavailable' : 'offline' },
      })
      expect(channels[1]?.poster).toBeUndefined()
      expect(updates[1]?.poster).toBeNull()

      const response = await GET()
      expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
      expect(await response.json()).toMatchObject({
        channels: [{ slug: 'friend-channel', status }, { slug: 'second-channel' }],
        updatedAt: expect.any(String),
      })
    }
    expect(fetcher).toHaveBeenCalledTimes(9)
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/v3/paths/list'),
      { cache: 'no-store', signal: expect.any(AbortSignal) },
    )
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

    const { getPublicChannels, loadChannelLiveUpdates } = await import('@/lib/channel-reads')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ items: [] }))
    expect((await getPublicChannels()).map(({ slug }) => slug)).toEqual(['second-channel'])
    expect((await loadChannelLiveUpdates()).map(({ slug }) => slug)).toEqual(['second-channel'])
  })
})
