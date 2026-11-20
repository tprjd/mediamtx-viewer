// @vitest-environment node
import Database from 'better-sqlite3'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const db = new Database(':memory:')
vi.mock('@/lib/auth/database', () => ({ getDatabase: () => db }))
const secret = 'private-fixture-secret-for-session-and-proxy'
process.env.BETTER_AUTH_SECRET = secret
process.env.INTERNAL_AUTH_SECRET = secret
const { GET } = await import('@/app/api/internal/authorize/route')
const { proxyMedia } = await import('./media-proxy')
const sessions = await import('./auth/session')
const viewing = await import('./viewing-access')

beforeAll(() => {
  for (const file of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${file}`, 'utf8'))
  }
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
afterAll(() => db.close())

function signedCookie(userId: string, lifetime = 60_000) {
  const token = randomUUID()
  const now = Date.now()
  db.prepare('INSERT INTO session (id, token, userId, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), token, userId, now + lifetime, now, now)
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`
}

function fixture() {
  const id = randomUUID()
  db.prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, activationStatus) VALUES (?, ?, ?, 1, 0, 0, 'active')")
    .run(id, id, `${id}@example.invalid`)
  const { path, slug } = db.prepare('SELECT media_path AS path, slug FROM channel WHERE owner_user_id = ?').get(id) as { path: string; slug: string }
  return { id, cookie: signedCookie(id), slug, path, directory: '/media/hls/' + path }
}

function caddy(cookie: string, uri: string, method = 'GET') {
  return GET(new Request('http://localhost/api/internal/authorize', {
    headers: { cookie, 'x-forwarded-uri': uri, 'x-forwarded-method': method, 'x-internal-auth': secret },
  }))
}

function direct(cookie: string, uri: string, method = 'GET') {
  return proxyMedia(new Request('http://localhost' + uri, { method, headers: { cookie } }))
}

it('shares one checked approval across playlist and part GET/HEAD requests on both entry points', async () => {
  const { id, cookie, directory } = fixture()
  const readSession = vi.spyOn(sessions, 'getActiveSession')
  const readChannel = vi.spyOn(viewing, 'checkMediaPath')
  const upstream = vi.fn(async () => new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', upstream)
  const [playlist, part, head] = await Promise.all([
    caddy(cookie, directory + '/index.m3u8?cookieCheck=1'),
    direct(cookie, directory + '/video_part7.mp4?session=fixture'),
    caddy(cookie, directory + '/audio.m3u8?_HLS_msn=7', 'HEAD'),
  ])
  expect([playlist.status, part.status, head.status]).toEqual([204, 200, 204])
  expect(playlist.headers.get('x-authenticated-user')).toBe(id)
  expect(playlist.headers.get('set-cookie')).toBeNull()
  expect(head.headers.get('cache-control')).toBe('no-store')
  expect(part.headers.get('cache-control')).toBe('private, no-store')
  const [url, init] = upstream.mock.calls[0] as unknown as [URL, RequestInit]
  expect(url.search).toBe('?session=fixture')
  expect(new Headers(init.headers).has('cookie')).toBe(false)
  expect((await caddy(cookie, directory + '/video_seg98.mp4')).status).toBe(204)
  expect(readSession).toHaveBeenCalledTimes(1)
  expect(readChannel).toHaveBeenCalledTimes(1)
})

it('isolates credentials, Channels, source generations and non-HLS requests', async () => {
  const { id, cookie, directory, path, slug } = fixture()
  const other = fixture()
  vi.stubEnv('WHIP_PILOT_CHANNEL', slug)
  const readSession = vi.spyOn(sessions, 'getActiveSession')
  const derivative = '/media/hls/_hls/' + path
  for (const uri of [directory, derivative + '/source-1', derivative + '/source-2']) {
    expect((await caddy(cookie, uri + '/index.m3u8')).status).toBe(204)
    expect((await caddy(cookie, uri + '/part1.mp4')).status).toBe(204)
  }
  expect(readSession).toHaveBeenCalledTimes(3)
  for (const altered of ['', 'better-auth.session_token=tampered', other.cookie, 'other=1; ' + cookie, signedCookie(id)]) {
    const expected = !altered || altered.endsWith('tampered') ? 401 : altered === other.cookie ? 403 : 204
    expect((await caddy(altered, directory + '/index.m3u8')).status).toBe(expected)
  }
  expect((await caddy(cookie, other.directory + '/index.m3u8')).status).toBe(403)
  const before = readSession.mock.calls.length
  for (const [uri, method] of [
    ['/media/whep/' + path + '/whep', 'POST'], ['/api/channels', 'GET'],
    [directory + '/idx.m3u8', 'POST'], [directory + '/nested/video.mp4', 'GET'],
    [directory + '/encoded%2Fvideo.mp4', 'GET'], [directory + '/%zz.mp4', 'GET'],
  ]) {
    const allowed = viewing.canRequestMedia(id, uri)
    for (let i = 0; i < 2; i++) expect((await caddy(cookie, uri, method)).status).toBe(allowed ? 204 : 403)
  }
  expect(readSession.mock.calls.length - before).toBe(12)
})

it('limits the approval from its first check and respects earlier session expiry', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'performance'] })
  const { id, cookie, directory } = fixture()
  const short = signedCookie(id, 500)
  const path = directory + '/index.m3u8'
  expect((await caddy(short, path)).status).toBe(204)
  expect((await caddy(cookie, path)).status).toBe(204)
  db.prepare('DELETE FROM session WHERE userId = ?').run(id)
  vi.advanceTimersByTime(500)
  expect((await caddy(short, path)).status).toBe(401)
  for (let i = 0; i < 3; i++) {
    vi.advanceTimersByTime(1000)
    expect((await caddy(cookie, path)).status).toBe(204)
  }
  vi.advanceTimersByTime(1500)
  const readSession = vi.spyOn(sessions, 'getActiveSession').mockRejectedValueOnce(new Error('unavailable'))
  expect((await caddy(cookie, path)).status).toBe(503)
  expect((await caddy(cookie, path)).status).toBe(401)
  expect(readSession).toHaveBeenCalledTimes(2)
})

it('starts a fresh check after a slow check crosses its deadline', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'performance'] })
  const { id, cookie, directory } = fixture()
  const path = directory + '/index.m3u8'
  const session = await sessions.getActiveSession(new Headers({ cookie }))
  const delayed = Promise.withResolvers<typeof session>()
  const lookup = vi.spyOn(sessions, 'getActiveSession').mockReturnValueOnce(delayed.promise)
  const first = caddy(cookie, path)
  const joined = caddy(cookie, path)
  db.prepare('DELETE FROM session WHERE userId = ?').run(id)
  vi.advanceTimersByTime(5001)
  expect((await caddy(cookie, path)).status).toBe(401)
  delayed.resolve(session)
  expect((await Promise.all([first, joined])).map(r => r.status)).toEqual([204, 204])
  expect((await caddy(cookie, path)).status).toBe(401)
  expect(lookup).toHaveBeenCalledTimes(3)
})

it.each(['Channel approval', 'Account suspension', 'Channel disabling'])(
  'honors %s on the first HLS request after the grace period and on every WHEP request',
  async change => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] })
    const owner = fixture()
    const viewer = fixture()
    const grantId = randomUUID()
    db.prepare("INSERT INTO channel_viewing_request (id, channel_id, viewer_id, status, revision, created_at, updated_at) SELECT ?, id, ?, 'approved', 1, 0, 0 FROM channel WHERE slug = ?")
      .run(grantId, viewer.id, owner.slug)
    const hls = owner.directory + '/index.m3u8'
    const whep = '/media/whep/' + owner.path + '/whep'
    expect((await caddy(viewer.cookie, hls)).status).toBe(204)
    if (change === 'Channel approval') db.prepare("UPDATE channel_viewing_request SET status = 'revoked' WHERE id = ?").run(grantId)
    if (change === 'Account suspension') db.prepare("UPDATE user SET activationStatus = 'disabled' WHERE id = ?").run(viewer.id)
    if (change === 'Channel disabling') db.prepare('UPDATE channel SET enabled = 0 WHERE slug = ?').run(owner.slug)
    const denial = change === 'Account suspension' ? 401 : 403
    expect((await caddy(viewer.cookie, hls)).status).toBe(204)
    expect((await caddy(viewer.cookie, whep, 'POST')).status).toBe(denial)
    vi.advanceTimersByTime(5000)
    expect((await caddy(viewer.cookie, hls)).status).toBe(denial)
  },
)

it('bounds pending checks, serves warm requests at capacity, and recovers after the checks finish', async () => {
  const { cookie, directory } = fixture()
  const path = directory + '/index.m3u8'
  expect((await caddy(cookie, path)).status).toBe(204)
  const delayed = Promise.withResolvers<null>()
  const read = vi.spyOn(sessions, 'getActiveSession').mockReturnValue(delayed.promise)
  const requests = Array.from({ length: 64 }, (_, i) => caddy(`unverified=${i}`, path))
  expect((await caddy('unverified=overflow', path)).status).toBe(503)
  expect((await direct('unverified=overflow', path)).status).toBe(503)
  expect((await caddy(cookie, path)).status).toBe(204)
  expect(read).toHaveBeenCalledTimes(64)
  delayed.resolve(null)
  expect((await Promise.all(requests)).every(response => response.status === 401)).toBe(true)
  expect((await caddy('unverified=overflow', path)).status).toBe(401)
})

it('evicts an old grant when the process cache is full', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'performance'] })
  const { cookie, directory } = fixture()
  const path = directory + '/index.m3u8'
  const session = await sessions.getActiveSession(new Headers({ cookie }))
  const read = vi.spyOn(sessions, 'getActiveSession').mockResolvedValue(session)
  for (let i = 0; i <= 1024; i++) {
    expect((await caddy(cookie + '; visit=' + i, path)).status).toBe(204)
  }
  read.mockClear()
  await caddy(cookie + '; visit=1024', path)
  expect(read).not.toHaveBeenCalled()
  await caddy(cookie + '; visit=0', path)
  expect(read).toHaveBeenCalledTimes(1)
})
