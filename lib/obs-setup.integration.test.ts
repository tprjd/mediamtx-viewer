// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testDirectory = mkdtempSync(join(tmpdir(), 'mediamtx-obs-setup-test-'))

process.env.AUTH_DB_PATH = join(testDirectory, 'auth.sqlite')
process.env.BETTER_AUTH_URL = 'http://localhost:3000'
process.env.BETTER_AUTH_SECRET = 'vitest-better-auth-secret-at-least-32-characters'
process.env.INTERNAL_AUTH_SECRET = 'vitest-internal-secret-at-least-32-characters'
process.env.MEDIAMTX_AUTH_SECRET = 'vitest-mediamtx-secret-at-least-32-characters'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/mediamtx', () => ({
  disconnectChannelPublisher: vi.fn().mockResolvedValue(undefined),
}))

describe('Windows OBS setup authorization', () => {
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
          ('disabled-id', 'Disabled', 'disabled@example.com', 0, ?, ?,
           'disabled', 'disabled', 'user', 1, 'disabled', NULL)`,
      )
      .run(now, now, now, now, now, now, now, now)
    const { grantStreaming } = await import('@/lib/channels')
    grantStreaming('admin-id', 'friend-id', 'friend-stream')
  })

  afterAll(async () => {
    const { getDatabase } = await import('@/lib/auth/database')
    getDatabase().close()
    rmSync(testDirectory, { recursive: true, force: true })
  })

  it('binds an approved setup to one channel and redeems it once', async () => {
    const { authorizePublish } = await import('@/lib/channels')
    const {
      approveObsSetupSession,
      createObsSetupSession,
      getObsSetupApproval,
      redeemObsSetupSession,
    } = await import('@/lib/obs-setup')
    const created = createObsSetupSession('lifecycle-address', '1.0.0')

    expect(getObsSetupApproval(created.userCode)).toMatchObject({ status: 'pending' })
    expect(() => redeemObsSetupSession(created.deviceSecret)).toThrowError(
      expect.objectContaining({ code: 'pending' }),
    )

    approveObsSetupSession(created.userCode, 'friend-id')
    expect(getObsSetupApproval(created.userCode)).toMatchObject({ status: 'approved' })
    const redeemed = redeemObsSetupSession(
      created.deviceSecret,
      Date.now() + 3_000,
    )
    expect(redeemed.streamKey.mediaPath).toBe('channels/friend-stream')
    expect(authorizePublish('channels/friend-stream', redeemed.streamKey.token)).toBe(true)
    expect(() =>
      redeemObsSetupSession(created.deviceSecret, Date.now() + 6_000),
    ).toThrowError(expect.objectContaining({ code: 'consumed' }))
  })

  it('expires and denies setup sessions without issuing credentials', async () => {
    const {
      createObsSetupSession,
      denyObsSetupSession,
      getObsSetupApproval,
      OBS_SETUP_EXPIRES_MS,
      redeemObsSetupSession,
    } = await import('@/lib/obs-setup')
    const expired = createObsSetupSession('expired-address', '1.0.0', 10_000)
    expect(
      getObsSetupApproval(expired.userCode, 10_000 + OBS_SETUP_EXPIRES_MS),
    ).toMatchObject({ status: 'expired' })
    expect(() =>
      redeemObsSetupSession(
        expired.deviceSecret,
        10_000 + OBS_SETUP_EXPIRES_MS,
      ),
    ).toThrowError(expect.objectContaining({ code: 'expired' }))

    const denied = createObsSetupSession('denied-address', '1.0.0')
    denyObsSetupSession(denied.userCode, 'friend-id')
    expect(() => redeemObsSetupSession(denied.deviceSecret)).toThrowError(
      expect.objectContaining({ code: 'denied' }),
    )
  })

  it('rejects unsupported scripts, inactive owners, and excessive starts', async () => {
    const {
      approveObsSetupSession,
      createObsSetupSession,
    } = await import('@/lib/obs-setup')
    expect(() => createObsSetupSession('old-version', '0.9.0')).toThrowError(
      expect.objectContaining({ code: 'unsupported_version' }),
    )

    const inactive = createObsSetupSession('inactive-address', '1.0.0')
    expect(() => approveObsSetupSession(inactive.userCode, 'disabled-id')).toThrowError(
      expect.objectContaining({ code: 'unavailable' }),
    )

    for (let count = 0; count < 5; count += 1) {
      createObsSetupSession('limited-address', '1.0.0')
    }
    expect(() => createObsSetupSession('limited-address', '1.0.0')).toThrowError(
      expect.objectContaining({ code: 'rate_limited' }),
    )
  })

  it('serves the public device API without exposing credentials before approval', async () => {
    const { POST: start } = await import('@/app/api/obs-setup/device/start/route')
    const startResponse = await start(
      new Request('http://localhost:3000/api/obs-setup/device/start', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.44',
        },
        body: JSON.stringify({ scriptVersion: '1.0.0' }),
      }),
    )
    expect(startResponse.status).toBe(200)
    expect(startResponse.headers.get('cache-control')).toContain('no-store')
    const started = await startResponse.json() as {
      deviceSecret: string
      userCode: string
      verificationUrl: string
    }
    expect(started.deviceSecret).toHaveLength(43)
    expect(started.verificationUrl).toContain(started.userCode)

    const { POST: poll } = await import('@/app/api/obs-setup/device/poll/route')
    const pendingResponse = await poll(
      new Request('http://localhost:3000/api/obs-setup/device/poll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceSecret: started.deviceSecret }),
      }),
    )
    expect(pendingResponse.status).toBe(200)
    await expect(pendingResponse.json()).resolves.toMatchObject({ status: 'pending' })

    const { approveObsSetupSession } = await import('@/lib/obs-setup')
    approveObsSetupSession(started.userCode, 'friend-id')
    const authorizedResponse = await poll(
      new Request('http://localhost:3000/api/obs-setup/device/poll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceSecret: started.deviceSecret }),
      }),
    )
    expect(authorizedResponse.status).toBe(200)
    const authorized = await authorizedResponse.json() as {
      status: string
      serverUrl: string
      bearerToken: string
      warning: string | null
    }
    expect(authorized).toMatchObject({
      status: 'authorized',
      serverUrl: 'http://localhost:3000/publish/whip/channels/friend-stream/whip',
      warning: null,
    })
    expect(authorized.bearerToken).toMatch(/^mtx_sk_/)
  })

  it('publishes a stable generic script with no credential material', async () => {
    const { getObsSetupScriptMetadata, readObsSetupScript } = await import(
      '@/lib/obs-setup-script'
    )
    const source = readObsSetupScript().toString('utf8')
    const metadata = getObsSetupScriptMetadata()

    expect(metadata).toMatchObject({ version: '1.0.0' })
    expect(metadata.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(source).toContain("$ScriptVersion = '1.0.0'")
    expect(source).toContain('obs_nvenc_av1_tex')
    expect(source).toContain('av1_texture_amf')
    expect(source).toContain('obs_qsv11_av1')
    expect(source).not.toMatch(/mtx_sk_[A-Za-z0-9_-]{20,}/)
  })

  it('rejects oversized device requests even without Content-Length', async () => {
    const { POST: start } = await import('@/app/api/obs-setup/device/start/route')
    const response = await start(
      new Request('http://localhost:3000/api/obs-setup/device/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scriptVersion: '1.0.0', padding: 'x'.repeat(1024) }),
      }),
    )

    expect(response.status).toBe(413)
  })
})
