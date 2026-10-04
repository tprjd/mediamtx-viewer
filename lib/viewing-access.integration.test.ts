// @vitest-environment node
import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const database = new Database(':memory:')
database.pragma('foreign_keys = ON')
vi.mock('@/lib/auth/database', () => ({ getDatabase: () => database }))
for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) database.exec(readFileSync(`migrations/${file}`, 'utf8'))
afterAll(() => database.close())

it('creates one channel at registration and keeps viewing approval separate from sign-in', async () => {
  const { getOwnedChannel } = await import('./channels')
  const { canWatchChannel } = await import('./viewing-access')
  database.prepare(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, activationStatus) VALUES (?, ?, ?, 1, 0, 0, 'active')`).run('owner', 'Owner', 'owner@example.test')
  database.prepare(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, activationStatus) VALUES (?, ?, ?, 1, 0, 0, 'active')`).run('viewer', 'Viewer', 'viewer@example.test')
  const channel = getOwnedChannel('owner')!
  expect(channel).not.toBeNull()
  expect(canWatchChannel('owner', channel.slug)).toBe(true)
  expect(canWatchChannel('viewer', channel.slug)).toBe(false)
})

it('deduplicates requests, persists approval, and rejects stale decisions across the retry boundary', async () => {
  const { getOwnedChannel } = await import('./channels')
  const { requestViewing, decideViewingRequest, listViewingRequests, listNotifications } = await import('./viewing-requests')
  const { canWatchChannel } = await import('./viewing-access')
  const channel = getOwnedChannel('owner')!
  requestViewing('viewer', channel.slug, 1000)
  requestViewing('viewer', channel.slug, 1001)
  expect(listNotifications('owner').notifications).toHaveLength(1)
  const request = listViewingRequests('owner')[0]
  expect(() => decideViewingRequest('viewer', request.id, request.revision, 'approved', 2000)).toThrow()
  decideViewingRequest('owner', request.id, request.revision, 'approved', 2000)
  expect(canWatchChannel('viewer', channel.slug)).toBe(true)
  decideViewingRequest('owner', request.id, request.revision + 1, 'revoked', 3000)
  expect(canWatchChannel('viewer', channel.slug)).toBe(false)
  expect(() => requestViewing('viewer', channel.slug, 1802999)).toThrow('30 minutes')
  requestViewing('viewer', channel.slug, 1803000)
  expect(() => decideViewingRequest('owner', request.id, request.revision, 'approved', 1803001)).toThrow('changed')
  expect(canWatchChannel('viewer', channel.slug)).toBe(false)
})

it('keeps stored channel approvals when administrator approval is removed', async () => {
  const { setAdministratorApproval, requestViewing, getViewingRequest, decideViewingRequest, listNotifications, markNotificationsRead, setNotificationSound } = await import('./viewing-requests')
  const { canWatchChannel, canRequestMedia, hasVerifiedOrLegacyAccountAccess } = await import('./viewing-access')
  const { getOwnedChannel, createOrRotateStreamKey, authorizePublish } = await import('./channels')
  database.prepare("UPDATE user SET role = 'admin' WHERE id = 'owner'").run()
  const channel = getOwnedChannel('owner')!
  const pending = getViewingRequest('viewer', channel.slug)!
  decideViewingRequest('owner', pending.id, pending.revision, 'approved')
  setAdministratorApproval('owner', 'viewer', true)
  setAdministratorApproval('owner', 'viewer', false)
  expect(canWatchChannel('viewer', channel.slug)).toBe(true)
  for (const path of [`/media/hls/${channel.mediaPath}/index.m3u8`, `/media/hls/${channel.mediaPath}/seg.mp4`, `/media/whep/${channel.mediaPath}/whep`, `/publish/whep/${channel.mediaPath}/whep/resource`]) expect(canRequestMedia('viewer', path)).toBe(true)
  database.prepare("UPDATE user SET emailVerified = 0 WHERE id = 'viewer'").run()
  expect(hasVerifiedOrLegacyAccountAccess('viewer')).toBe(false)
  expect(() => createOrRotateStreamKey('viewer')).toThrow('disabled')
  const key = createOrRotateStreamKey('owner')
  expect(authorizePublish(channel.mediaPath, key.token)).toBe(true)
  const approved = getViewingRequest('viewer', channel.slug)!
  decideViewingRequest('owner', approved.id, approved.revision, 'revoked')
  expect(canRequestMedia('viewer', `/media/hls/${channel.mediaPath}/seg.mp4`)).toBe(false)
  expect(() => requestViewing('viewer', channel.slug)).toThrow('Verify')
  expect(listNotifications('viewer').unread).toBeGreaterThan(0)
  markNotificationsRead('viewer')
  expect(listNotifications('viewer').unread).toBe(0)
  expect(getViewingRequest('viewer', channel.slug)?.status).toBe('revoked')
  setNotificationSound('viewer', false)
  setAdministratorApproval('owner', 'viewer', true)
  expect(listNotifications('viewer')).toMatchObject({ sound: false, unread: 1 })
  database.prepare("UPDATE user SET activationStatus = 'disabled' WHERE id = 'viewer'").run()
  expect(canWatchChannel('viewer', channel.slug)).toBe(false)
})

it('migrates existing accounts without falsely verifying email or replacing channels', () => {
  const old = new Database(':memory:')
  old.pragma('foreign_keys = ON')
  for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '007').sort()) old.exec(readFileSync(`migrations/${file}`, 'utf8'))
  for (const status of ['active', 'pending', 'disabled']) old.prepare(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, activationStatus) VALUES (?, ?, ?, 0, 0, 0, ?)`).run(status, status, `${status}@test.invalid`, status)
  old.exec(`INSERT INTO channel (id, owner_user_id, slug, media_path, display_name, title, created_at, updated_at) VALUES ('original', 'active', 'original', 'original', 'Original', 'Original', 0, 0)`)
  old.exec(readFileSync('migrations/007_open_registration.sql', 'utf8'))
  expect(old.prepare('SELECT activationStatus, administratorApproved, emailVerified, legacyAccess FROM user WHERE id = ?').get('active')).toEqual({ activationStatus: 'active', administratorApproved: 1, emailVerified: 0, legacyAccess: 1 })
  expect(old.prepare('SELECT activationStatus, administratorApproved FROM user WHERE id = ?').get('pending')).toEqual({ activationStatus: 'active', administratorApproved: 0 })
  expect(old.prepare('SELECT id FROM channel WHERE owner_user_id = ?').get('active')).toEqual({ id: 'original' })
  expect(old.prepare('SELECT COUNT(*) AS count FROM channel').get()).toEqual({ count: 2 })
  old.prepare("UPDATE user SET activationStatus = 'active' WHERE id = 'disabled'").run()
  expect(old.prepare('SELECT COUNT(*) AS count FROM channel').get()).toEqual({ count: 3 })
  old.close()
})

it('rejects a previously issued chat credential after channel approval is removed', async () => {
  vi.stubEnv('CHAT_ENABLED', 'true')
  const { getOwnedChannel } = await import('./channels')
  const { setAdministratorApproval } = await import('./viewing-requests')
  const { createChatConnectionToken } = await import('./chat-realtime')
  const { checkChatConnection, refreshChatConnection } = await import('./chat-connection-access')
  database.prepare("UPDATE user SET activationStatus = 'active', emailVerified = 1 WHERE id = 'viewer'").run()
  setAdministratorApproval('owner', 'viewer', true)
  const channel = getOwnedChannel('owner')!
  database.prepare('INSERT INTO session (id, token, userId, createdAt, updatedAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)').run('viewer-session', 'session-token', 'viewer', Date.now(), Date.now(), Date.now() + 60_000)
  const token = createChatConnectionToken({ accountId: 'viewer', channelId: channel.id, sessionId: 'viewer-session' })
  expect(checkChatConnection(token)?.user).toBe('viewer')
  setAdministratorApproval('owner', 'viewer', false)
  expect(checkChatConnection(token)).toBeNull()
  expect(refreshChatConnection({ accountId: 'viewer', channelId: channel.id, sessionId: 'viewer-session' })).toEqual({ expired: true })
  vi.unstubAllEnvs()
})
