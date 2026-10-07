// @vitest-environment node

import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setAccountChannelEnabled, suspendAccount } from './account-restrictions'
import { authorizePublish, createOrRotateStreamKey, getOwnedChannel } from './channels'
import { channelEnabledAction, disableAction } from '@/app/admin/users/actions'

vi.mock('server-only', () => ({}))
let database: Database.Database
vi.mock('@/lib/auth/database', () => ({ getDatabase: () => database }))
const mocks = vi.hoisted(() => ({ chat: vi.fn(), media: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/chat-realtime', () => ({ disconnectChatParticipant: mocks.chat }))
vi.mock('@/lib/mediamtx', () => ({ disconnectChannelSessions: mocks.media }))
vi.mock('@/lib/auth/session', () => ({ requireAdminSession: mocks.admin }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(path) } }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.admin.mockResolvedValue({ user: { id: 'admin' } })
  mocks.chat.mockResolvedValue(undefined)
  mocks.media.mockResolvedValue(undefined)
  database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  database.exec('CREATE TABLE app_migration (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)')
  for (const name of readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort()) {
    database.exec(readFileSync(join('migrations', name), 'utf8'))
  }
  for (const id of ['admin', 'owner']) {
    database.prepare(`INSERT INTO user
      (id, name, email, emailVerified, createdAt, updatedAt, username, role, activationStatus, administratorApproved, banned)
      VALUES (?, ?, ?, 1, 1, 1, ?, ?, 'active', 1, 0)`)
      .run(id, id, `${id}@example.test`, id, id === 'admin' ? 'admin' : 'user')
  }
  database.prepare(`INSERT INTO session (id, token, userId, createdAt, updatedAt, expiresAt)
    VALUES ('session', 'token', 'owner', 1, 1, ?)`).run(Date.now() + 60_000)
  database.prepare(`INSERT INTO channel_viewing_request (id, channel_id, viewer_id, status, created_at, updated_at)
    SELECT 'approval', id, 'owner', 'approved', 1, 1 FROM channel WHERE owner_user_id = 'admin'`).run()
  createOrRotateStreamKey('owner')
  database.exec('DELETE FROM auth_audit_log')
})

afterEach(() => database.close())

function accountState() {
  return database.prepare('SELECT activationStatus, banned, administratorApproved FROM user WHERE id = ?').get('owner')
}

function expectStoredSuspension() {
  expect(accountState()).toEqual({ activationStatus: 'disabled', banned: 1, administratorApproved: 1 })
  expect(database.prepare('SELECT * FROM session WHERE userId = ?').all('owner')).toEqual([])
  expect(getOwnedChannel('owner')).toMatchObject({ enabled: false, hasStreamKey: false })
  expect(database.prepare('SELECT status FROM channel_viewing_request WHERE id = ?').get('approval')).toEqual({ status: 'approved' })
  expect(database.prepare('SELECT user_id, media_path, chat_done, media_done FROM access_revocation').all())
    .toEqual([{ user_id: 'owner', media_path: null, chat_done: 0, media_done: 0 }])
}

describe('Account suspension completion', () => {
  it('commits restrictions before network work and preserves the separate durable retry', async () => {
    const channel = getOwnedChannel('owner')!
    const key = createOrRotateStreamKey('owner')
    database.exec('DELETE FROM auth_audit_log')
    mocks.chat.mockImplementation(async () => {
      expect(database.inTransaction).toBe(false)
      expectStoredSuspension()
      expect(authorizePublish(channel.mediaPath, key.token)).toBe(false)
      expect(mocks.media).not.toHaveBeenCalled()
    })
    await expect(suspendAccount('admin', 'owner')).resolves.toEqual({ chat: 'completed', media: 'completed' })
    expect(mocks.chat).toHaveBeenCalledExactlyOnceWith('owner')
    expect(mocks.media).toHaveBeenCalledExactlyOnceWith(channel.mediaPath)
    expectStoredSuspension()
    expect(database.prepare('SELECT action FROM auth_audit_log ORDER BY rowid').all())
      .toEqual([{ action: 'streaming_disabled' }, { action: 'disable' }])
  })

  it.each([[true, false], [false, true], [true, true]])(
    'keeps restrictions when Chat failure is %s and media failure is %s', async (chatFails, mediaFails) => {
      if (chatFails) mocks.chat.mockRejectedValue(new Error('Chat unavailable'))
      if (mediaFails) mocks.media.mockRejectedValue(new Error('MediaMTX unavailable'))
      await expect(suspendAccount('admin', 'owner')).resolves.toEqual({
        chat: chatFails ? 'unconfirmed' : 'completed',
        media: mediaFails ? 'unconfirmed' : 'completed',
      })
      expectStoredSuspension()
      expect(mocks.chat).toHaveBeenCalledTimes(1)
      expect(mocks.media).toHaveBeenCalledTimes(1)
    },
  )

  it('suspends an account without an owned Channel', async () => {
    database.prepare('DELETE FROM channel WHERE owner_user_id = ?').run('owner')
    await expect(suspendAccount('admin', 'owner')).resolves.toEqual({ chat: 'completed', media: 'not-required' })
    expect(accountState()).toMatchObject({ activationStatus: 'disabled' })
    expect(mocks.chat).toHaveBeenCalledExactlyOnceWith('owner')
    expect(mocks.media).not.toHaveBeenCalled()
    expect(database.prepare('SELECT user_id FROM access_revocation').all()).toEqual([{ user_id: 'owner' }])
  })

  it.each([
    ['admin', 'missing', 'User not found'],
    ['owner', 'owner', 'You cannot disable your own account'],
    ['owner', 'admin', 'The final active administrator cannot be disabled'],
  ])('rejects invalid suspension by %s of %s before network work', async (actor, target, error) => {
    await expect(suspendAccount(actor, target)).rejects.toThrow(error)
    expect(accountState()).toMatchObject({ activationStatus: 'active' })
    expect(mocks.chat).not.toHaveBeenCalled()
    expect(mocks.media).not.toHaveBeenCalled()
  })

  it('rolls back all restrictions and skips network work if the transaction fails', async () => {
    database.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON auth_audit_log
      BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`)
    await expect(suspendAccount('admin', 'owner')).rejects.toThrow('audit unavailable')
    expect(accountState()).toMatchObject({ activationStatus: 'active', banned: 0 })
    expect(getOwnedChannel('owner')).toMatchObject({ enabled: true, hasStreamKey: true })
    expect(database.prepare('SELECT id FROM session').all()).toEqual([{ id: 'session' }])
    expect(database.prepare('SELECT * FROM access_revocation').all()).toEqual([])
    expect(mocks.chat).not.toHaveBeenCalled()
    expect(mocks.media).not.toHaveBeenCalled()
  })
})

describe('Channel restriction completion', () => {
  it.each([false, true])('disables only the Channel when media failure is %s', async (mediaFails) => {
    const channel = getOwnedChannel('owner')!
    if (mediaFails) mocks.media.mockRejectedValue(new Error('MediaMTX unavailable'))
    await expect(setAccountChannelEnabled('admin', 'owner', false)).resolves
      .toEqual({ media: mediaFails ? 'unconfirmed' : 'completed' })
    expect(getOwnedChannel('owner')).toMatchObject({ enabled: false, hasStreamKey: false })
    expect(accountState()).toEqual({ activationStatus: 'active', banned: 0, administratorApproved: 1 })
    expect(database.prepare('SELECT id FROM session').all()).toEqual([{ id: 'session' }])
    expect(database.prepare('SELECT status FROM channel_viewing_request').all()).toEqual([{ status: 'approved' }])
    expect(database.prepare('SELECT * FROM access_revocation').all()).toEqual([])
    expect(mocks.chat).not.toHaveBeenCalled()
    expect(mocks.media).toHaveBeenCalledExactlyOnceWith(channel.mediaPath)
  })

  it('enables the Channel without disconnecting sessions or replacing a revoked key', async () => {
    await setAccountChannelEnabled('admin', 'owner', false)
    mocks.media.mockClear()
    await expect(setAccountChannelEnabled('admin', 'owner', true)).resolves.toEqual({ media: 'not-required' })
    expect(getOwnedChannel('owner')).toMatchObject({ enabled: true, hasStreamKey: false })
    expect(mocks.media).not.toHaveBeenCalled()
    expect(mocks.chat).not.toHaveBeenCalled()
  })

  it('rejects enabling a suspended account before network work', async () => {
    await suspendAccount('admin', 'owner')
    mocks.media.mockClear()
    mocks.chat.mockClear()
    await expect(setAccountChannelEnabled('admin', 'owner', true)).rejects.toThrow('Activate the account')
    expect(getOwnedChannel('owner')).toMatchObject({ enabled: false })
    expect(mocks.media).not.toHaveBeenCalled()
    expect(mocks.chat).not.toHaveBeenCalled()
  })
})

describe('administrator actions', () => {
  it.each(['suspend', 'channel'] as const)('requires administrator access before %s', async (action) => {
    mocks.admin.mockRejectedValue(new Error('Administrator required'))
    const form = new FormData()
    form.set('enabled', 'false')
    await expect(action === 'suspend' ? disableAction('owner') : channelEnabledAction('owner', form))
      .rejects.toThrow('Administrator required')
    expect(accountState()).toMatchObject({ activationStatus: 'active' })
    expect(getOwnedChannel('owner')).toMatchObject({ enabled: true, hasStreamKey: true })
    expect(mocks.chat).not.toHaveBeenCalled()
    expect(mocks.media).not.toHaveBeenCalled()
  })

  it('shows a stored-operation error without claiming completion', async () => {
    await expect(disableAction('missing')).rejects.toThrow('/admin/users?error=User%20not%20found')
  })

  it.each([
    [false, false, 'Account disabled and sessions revoked.'],
    [true, false, 'Account disabled and sessions revoked. Centrifugo could not confirm Chat disconnection.'],
    [false, true, 'Account disabled and credentials revoked. MediaMTX could not confirm active stream disconnection.'],
    [true, true, 'Account disabled and credentials revoked. MediaMTX could not confirm active stream disconnection.'],
  ])('preserves the suspension notice with Chat failure %s and media failure %s', async (chatFails, mediaFails, notice) => {
    if (chatFails) mocks.chat.mockRejectedValue(new Error('Chat unavailable'))
    if (mediaFails) mocks.media.mockRejectedValue(new Error('MediaMTX unavailable'))
    await expect(disableAction('owner')).rejects.toThrow(`/admin/users?notice=${encodeURIComponent(notice)}`)
    expectStoredSuspension()
  })
})
