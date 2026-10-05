// @vitest-environment node

import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelMonitorEvent, ChannelMonitorListener } from '@/lib/channel-status-monitor'
import type { ChannelStatus } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  getChannelStatus: vi.fn(),
  getChannelStatuses: vi.fn(),
  getActiveSession: vi.fn(),
  subscribe: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/database', () => ({ getDatabase: () => database }))
vi.mock('@/lib/mediamtx', () => ({
  getChannelStatus: mocks.getChannelStatus,
  getChannelStatuses: mocks.getChannelStatuses,
}))
vi.mock('@/lib/auth/session', () => ({ getActiveSession: mocks.getActiveSession }))
vi.mock('@/lib/channel-status-monitor', () => ({
  getChannelStatusMonitor: () => ({ subscribe: mocks.subscribe }),
}))

const database = new Database(':memory:')
database.pragma('foreign_keys = ON')
for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
  database.exec(readFileSync(join('migrations', name), 'utf8'))
}
const thumbnails = mkdtempSync(join(tmpdir(), 'channel-read-test-'))
const thumbnail = join(thumbnails, 'channels%2Flive-channel.jpg')
writeFileSync(thumbnail, 'thumbnail fixture')
utimesSync(thumbnail, new Date(123_000), new Date(123_000))
vi.stubEnv('THUMBNAIL_DIR', thumbnails)

const {
  getPublicChannels,
  getPublicChannelStatus,
  getPublicChannelEvent,
  getPublicChannelDirectory,
  loadChannelLiveUpdates,
} = await import('./channel-reads')
const { GET: getEvents } = await import('@/app/api/channel-events/route')
const { GET: getStatus } = await import('@/app/api/channels/[slug]/status/route')

const slug = 'live-channel'
const status: ChannelStatus = {
  state: 'live', live: true, startedAt: '2026-10-05T10:00:00.000Z',
  tracks: ['H264', 'Opus'], viewerCount: 7, checkedAt: '2026-10-05T10:01:00.000Z',
}
const restrictedStatus = { ...status, tracks: [], viewerCount: null }
const poster = `/api/channels/${slug}/thumbnail?v=123000`
const publicChannel = {
  slug, ownerName: 'Owner', title: 'Owner channel', description: 'Channel description',
  poster, accentColor: '#22c55e', preferredPlayback: 'webrtc', hasCompatibilityFallback: false,
  playback: {
    hls: `/media/hls/channels/${slug}/index.m3u8?cookieCheck=1`,
    webrtc: `/media/whep/channels/${slug}/whep`,
  },
  status, viewingAllowed: true,
}
const restrictedChannel = {
  ...publicChannel, description: undefined, poster: undefined,
  playback: { hls: '', webrtc: '' }, status: restrictedStatus, viewingAllowed: false,
}
const liveUpdate = {
  slug, ownerName: 'Owner', title: 'Owner channel', discordNotificationsEnabled: true,
  status, poster,
}
const snapshot: ChannelMonitorEvent = {
  id: 42, type: 'snapshot', data: { channels: [liveUpdate], updatedAt: status.checkedAt },
}

function serialized(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

function approveChannel() {
  database.prepare(`INSERT INTO channel_viewing_request
    (id, channel_id, viewer_id, status, created_at, updated_at)
    SELECT 'approval', id, 'viewer', 'approved', 0, 0 FROM channel WHERE slug = ?`).run(slug)
}

beforeEach(() => {
  vi.clearAllMocks()
  database.exec('DELETE FROM user')
  for (const [id, name] of [['owner', 'Owner'], ['viewer', 'Viewer']]) {
    database.prepare(`INSERT INTO user (id, name, email, emailVerified, activationStatus, createdAt, updatedAt)
      VALUES (?, ?, ?, 1, 'active', 0, 0)`).run(id, name, `${id}@example.test`)
  }
  database.prepare(`UPDATE channel SET slug = ?, media_path = ?, title = 'Owner channel',
    description = 'Channel description', accent_color = '#22c55e', preferred_playback = 'webrtc',
    discord_notifications_enabled = 1 WHERE owner_user_id = 'owner'`).run(slug, `channels/${slug}`)
  mocks.getChannelStatus.mockResolvedValue(status)
  mocks.getChannelStatuses.mockImplementation(async (paths: string[]) => new Map(paths.map(path => [path, status])))
  mocks.getActiveSession.mockResolvedValue({ user: { id: 'viewer' } })
})
afterEach(() => vi.useRealTimers())
afterAll(() => {
  database.close()
  rmSync(thumbnails, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('Channel read interface', () => {
  it.each(['owner', 'administrator-approved', 'channel-approved', 'restricted', 'suspended'])(
    'preserves all response shapes for account relationship %s', async (relationship) => {
      const viewerId = relationship === 'owner' ? 'owner' : 'viewer'
      if (relationship === 'administrator-approved') database.exec("UPDATE user SET administratorApproved = 1 WHERE id = 'viewer'")
      if (relationship === 'channel-approved') approveChannel()
      if (relationship === 'suspended') database.exec("UPDATE user SET activationStatus = 'disabled', administratorApproved = 1 WHERE id = 'viewer'")
      const hidden = relationship === 'suspended'
      const allowed = relationship !== 'restricted' && !hidden
      const expectedChannel = allowed ? publicChannel : restrictedChannel
      const expectedUpdate = {
        ...liveUpdate, viewingAllowed: allowed,
        poster: allowed ? poster : null, status: allowed ? status : restrictedStatus,
      }
      const channels = await getPublicChannels(viewerId)
      expect(serialized(channels.filter(channel => channel.slug === slug)))
        .toEqual(hidden ? [] : [serialized(expectedChannel)])
      await expect(getPublicChannelStatus(viewerId, slug)).resolves.toEqual(hidden ? null : allowed ? status : restrictedStatus)
      for (const type of ['snapshot', 'directory'] as const) {
        expect(getPublicChannelEvent(viewerId, { ...snapshot, type })).toEqual({
          ...snapshot, type, data: { ...snapshot.data, channels: hidden ? [] : [expectedUpdate] },
        })
      }
      const update: ChannelMonitorEvent = { id: 43, type: 'channel-status', data: liveUpdate }
      expect(getPublicChannelEvent(viewerId, update)).toEqual(hidden ? null : { ...update, data: expectedUpdate })
      const directory = await getPublicChannelDirectory(viewerId)
      expect(serialized(directory.channels.filter(channel => channel.slug === slug))).toEqual(hidden ? [] : [{
        ...serialized(expectedChannel), discordNotificationsEnabled: false, poster: allowed ? poster : null,
      }])
      expect(Number.isFinite(Date.parse(directory.updatedAt))).toBe(true)
    },
  )

  it.each(['unverified', 'suspended', 'disabled'])('hides a Channel from other accounts when its owner or Channel is %s', async (state) => {
    if (state === 'unverified') database.exec("UPDATE user SET emailVerified = 0 WHERE id = 'owner'")
    if (state === 'suspended') database.exec("UPDATE user SET activationStatus = 'disabled' WHERE id = 'owner'")
    if (state === 'disabled') database.exec("UPDATE channel SET enabled = 0 WHERE owner_user_id = 'owner'")
    database.exec("UPDATE user SET administratorApproved = 1 WHERE id = 'viewer'")
    expect((await getPublicChannels('viewer')).some(channel => channel.slug === slug)).toBe(false)
    await expect(getPublicChannelStatus('viewer', slug)).resolves.toBeNull()
    expect(getPublicChannelEvent('viewer', snapshot)).toEqual({ ...snapshot, data: { ...snapshot.data, channels: [] } })
    expect(getPublicChannelEvent('viewer', { id: 43, type: 'channel-status', data: liveUpdate })).toBeNull()
    expect(mocks.getChannelStatus).not.toHaveBeenCalled()
  })

  it.each(['unverified', 'disabled'])('preserves the owner exception for %s Channels without changing monitor selection', async (state) => {
    if (state === 'unverified') database.exec("UPDATE user SET emailVerified = 0 WHERE id = 'owner'")
    else database.exec("UPDATE channel SET enabled = 0 WHERE owner_user_id = 'owner'")
    expect(serialized((await getPublicChannels('owner')).find(channel => channel.slug === slug))).toEqual(publicChannel)
    expect((await getPublicChannelDirectory('owner')).channels.some(channel => channel.slug === slug)).toBe(true)
    await expect(getPublicChannelStatus('owner', slug)).resolves.toEqual(state === 'disabled' ? null : status)
    expect((await loadChannelLiveUpdates()).some(channel => channel.slug === slug)).toBe(false)
  })

  it('keeps legacy owners visible without marking their email verified', async () => {
    database.exec("UPDATE user SET emailVerified = 0, legacyAccess = 1 WHERE id = 'owner'")
    expect(serialized((await getPublicChannels('viewer')).find(channel => channel.slug === slug))).toEqual(serialized(restrictedChannel))
    await expect(getPublicChannelStatus('owner', slug)).resolves.toEqual(status)
  })

  it('filters current access without changing the shared monitor data or internal Discord preference', async () => {
    const before = structuredClone(snapshot)
    getPublicChannelEvent('viewer', snapshot)
    const allowed = getPublicChannelEvent('owner', snapshot)
    expect(allowed).toEqual({ ...snapshot, data: { ...snapshot.data, channels: [{ ...liveUpdate, viewingAllowed: true }] } })
    expect(snapshot).toEqual(before)
    expect((await loadChannelLiveUpdates()).find(channel => channel.slug === slug)).toEqual(liveUpdate)
  })

  it('uses the access decision after a status read completes', async () => {
    approveChannel()
    mocks.getChannelStatus.mockImplementationOnce(async () => {
      database.exec("UPDATE channel_viewing_request SET status = 'revoked'")
      return status
    })
    await expect(getPublicChannelStatus('viewer', slug)).resolves.toEqual(restrictedStatus)
  })

  it('returns no status for an unknown Channel without reading MediaMTX', async () => {
    await expect(getPublicChannelStatus('owner', 'missing')).resolves.toBeNull()
    expect(mocks.getChannelStatus).not.toHaveBeenCalled()
  })
})

describe('Channel route adapters', () => {
  it('filters approval removal during one open event connection and preserves the full periodic directory', async () => {
    vi.useFakeTimers()
    approveChannel()
    let send: ChannelMonitorListener | undefined
    const stop = vi.fn()
    mocks.subscribe.mockImplementation(async (listener: ChannelMonitorListener) => {
      send = listener
      listener(snapshot)
      return stop
    })
    const controller = new AbortController()
    const request = new Request('https://example.test/api/channel-events', { signal: controller.signal })
    const response = await getEvents(request)
    const reader = response.body!.getReader()
    const nextEvent = async () => new TextDecoder().decode((await reader.read()).value)
    try {
      const initial = await nextEvent()
      expect(initial).toContain('id: 42\nevent: snapshot\n')
      expect(initial).toContain(`"poster":"${poster}"`)
      database.exec("UPDATE channel_viewing_request SET status = 'revoked'")
      send!({ id: 43, type: 'channel-status', data: liveUpdate })
      expect(await nextEvent()).toBe(`id: 43\nevent: channel-status\ndata: ${JSON.stringify({
        ...liveUpdate, viewingAllowed: false, poster: null, status: restrictedStatus,
      })}\n\n`)
      await vi.advanceTimersByTimeAsync(5_000)
      const refresh = await nextEvent()
      expect(refresh).toMatch(/^event: directory\ndata: /)
      const payload = JSON.parse(refresh.split('data: ')[1])
      expect(payload.channels.find((channel: { slug: string }) => channel.slug === slug)).toEqual({
        ...serialized(restrictedChannel), poster: null, discordNotificationsEnabled: false,
      })
      expect(mocks.getActiveSession).toHaveBeenLastCalledWith(request.headers)
      mocks.getActiveSession.mockResolvedValue(null)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(await reader.read()).toEqual({ done: true, value: undefined })
      expect(stop).toHaveBeenCalledOnce()
    } finally {
      controller.abort()
      await reader.cancel()
    }
  })

  it('returns the filtered status and keeps the existing cache headers', async () => {
    const response = await getStatus(new Request('https://example.test'), { params: Promise.resolve({ slug }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    expect(await response.json()).toEqual({ status: restrictedStatus })
  })

  it('returns 404 for a disabled Channel even when the owner requests its status', async () => {
    database.exec("UPDATE channel SET enabled = 0 WHERE owner_user_id = 'owner'")
    mocks.getActiveSession.mockResolvedValue({ user: { id: 'owner' } })
    const response = await getStatus(new Request('https://example.test'), { params: Promise.resolve({ slug }) })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Channel not found' })
  })

  it('rejects a status request without an account session', async () => {
    mocks.getActiveSession.mockResolvedValue(null)
    const response = await getStatus(new Request('https://example.test'), { params: Promise.resolve({ slug }) })
    expect(response.status).toBe(401)
    expect(mocks.getChannelStatus).not.toHaveBeenCalled()
  })
})
