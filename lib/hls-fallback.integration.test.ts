// @vitest-environment node
import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
process.env.MEDIAMTX_AUTH_SECRET = 'test-mediamtx-auth-secret'
vi.mock('server-only', () => ({}))
const database = new Database(':memory:')
vi.mock('@/lib/auth/database', () => ({ getDatabase: () => database }))
for (const name of readdirSync('migrations').filter(x => x.endsWith('.sql')).sort()) database.exec(readFileSync(`migrations/${name}`, 'utf8'))
afterAll(() => database.close())
afterEach(() => vi.unstubAllEnvs())

it('protects derivative manifests and segments with the original Channel Viewing access', async () => {
  const { getOwnedChannel } = await import('./channels')
  const { canRequestMedia } = await import('./viewing-access')
  database.exec("INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt,activationStatus) VALUES ('owner','Owner','owner@test.invalid',1,0,0,'active')")
  const channel = getOwnedChannel('owner')!
  vi.stubEnv('WHIP_PILOT_CHANNEL', channel.slug)
  for (const resource of ['index.m3u8', 'segment.mp4']) {
    expect(canRequestMedia('owner', `/media/hls/_hls/${channel.mediaPath}/source-1/${resource}`)).toBe(true)
    expect(canRequestMedia('unknown', `/media/hls/_hls/${channel.mediaPath}/source-1/${resource}`)).toBe(false)
  }
  expect(canRequestMedia('owner', `/media/whep/_hls/${channel.mediaPath}/source-1/whep`)).toBe(false)
  database.exec("UPDATE user SET activationStatus='disabled' WHERE id='owner'")
  expect(canRequestMedia('owner', `/media/hls/_hls/${channel.mediaPath}/source-1/index.m3u8`)).toBe(false)
})

it('issues scoped worker jobs and rejects stale source generations and rotated keys', async () => {
  const { getOwnedChannel, createOrRotateStreamKey } = await import('./channels')
  const { GET } = await import('../app/api/internal/hls-worker/route')
  const { POST } = await import('../app/api/internal/mediamtx/authorize/route')
  database.exec("UPDATE user SET activationStatus='active' WHERE id='owner'")
  const channel = getOwnedChannel('owner')!
  createOrRotateStreamKey('owner')
  vi.stubEnv('WHIP_PILOT_CHANNEL', channel.slug)
  vi.stubEnv('HLS_WORKER_SECRET', 'separate-worker-secret-at-least-32-characters')
  let sourceId = 'source-1'
  vi.stubGlobal('fetch', async () => Response.json({ items: [{ name: channel.mediaPath, ready: true, readyTime: new Date().toISOString(), source: { type: 'webRTCSession', id: sourceId }, tracks: ['H264', 'Opus'] }] }))
  const request = new Request('http://localhost/api/internal/hls-worker', { headers: { 'x-hls-worker-secret': process.env.HLS_WORKER_SECRET! } })
  expect((await GET(new Request(request.url))).status).toBe(404)
  const response = await GET(request)
  const { jobs } = await response.json()
  expect(jobs).toHaveLength(1)
  expect(jobs[0]).toMatchObject({ sourcePath: channel.mediaPath, outputPath: `_hls/${channel.mediaPath}/source-1` })
  const { authEnvironment } = await import('./auth/env')
  const authorize = (action: string, path: string, password: string, protocol = 'rtsp') => POST(new Request(`http://localhost/api/internal/mediamtx/authorize?secret=${authEnvironment.mediaMtxAuthSecret}`, { method: 'POST', body: JSON.stringify({ action, path, password, protocol, user: 'hls-worker' }) }))
  expect((await authorize('read', channel.mediaPath, jobs[0].credential)).status).toBe(204)
  expect((await authorize('publish', jobs[0].outputPath, jobs[0].credential)).status).toBe(204)
  expect((await authorize('publish', channel.mediaPath, jobs[0].credential)).status).toBe(401)
  expect((await authorize('publish', jobs[0].outputPath, 'wrong')).status).toBe(401)
  expect((await authorize('read', jobs[0].outputPath, '', 'webrtc')).status).toBe(403)
  sourceId = 'source-2'
  await GET(request)
  expect((await authorize('publish', jobs[0].outputPath, jobs[0].credential)).status).toBe(401)
  sourceId = 'source-1'
  await GET(request)
  createOrRotateStreamKey('owner')
  expect((await authorize('publish', jobs[0].outputPath, jobs[0].credential)).status).toBe(401)
  database.exec("UPDATE channel SET enabled=0 WHERE owner_user_id='owner'")
  expect((await (await GET(request)).json()).jobs).toEqual([])
  vi.unstubAllGlobals()
})
