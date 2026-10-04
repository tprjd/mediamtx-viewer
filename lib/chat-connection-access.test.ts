// @vitest-environment node
import Database from 'better-sqlite3'
import { afterAll, beforeEach, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const database = new Database(':memory:')
database.exec('CREATE TABLE session (id TEXT PRIMARY KEY, userId TEXT, expiresAt INTEGER); CREATE TABLE channel (id TEXT PRIMARY KEY, slug TEXT, enabled INTEGER)')
database.prepare('INSERT INTO channel VALUES (?, ?, 1)').run('channel', 'test')
vi.mock('@/lib/auth/database', () => ({ getDatabase: () => database }))
vi.mock('@/lib/chat-environment', () => ({ isChatEnabled: () => true, chatEnvironment: { centrifugoTokenHmacSecret: 'session-binding-test-secret' } }))
vi.mock('@/lib/chat-maintenance', () => ({ isChatRestoring: () => false }))
const access = vi.hoisted(() => ({ allowed: true }))
vi.mock('@/lib/viewing-access', () => ({ canWatchChannel: () => access.allowed }))

import { checkChatConnection, refreshChatConnection } from './chat-connection-access'
import { createChatConnectionToken } from './chat-realtime'

const identity = { accountId: 'viewer', channelId: 'channel', sessionId: 'original-session' }
beforeEach(() => {
  access.allowed = true
  database.exec('DELETE FROM session')
  database.prepare('INSERT INTO session VALUES (?, ?, ?)').run(identity.sessionId, identity.accountId, Date.now() + 60_000)
})
afterAll(() => database.close())

it('binds connection metadata to the issuing session and permits its refresh', () => {
  const result = checkChatConnection(createChatConnectionToken(identity))
  expect(result?.meta).toEqual(identity)
  expect(refreshChatConnection(result?.meta)).toHaveProperty('expire_at')
})

it.each(['revoked', 'expired', 'different-account'])('rejects initial connections and refreshes when the issuing session is %s', (state) => {
  const token = createChatConnectionToken(identity)
  const meta = checkChatConnection(token)?.meta
  expect(meta).toBeDefined()
  if (state === 'revoked') database.exec('DELETE FROM session')
  if (state === 'expired') database.prepare('UPDATE session SET expiresAt = ?').run(Date.now() - 1)
  if (state === 'different-account') database.prepare('UPDATE session SET userId = ?').run('other-account')
  // A different valid session must not keep the revoked connection alive.
  database.prepare('INSERT INTO session VALUES (?, ?, ?)').run('new-session', identity.accountId, Date.now() + 60_000)
  expect(checkChatConnection(token)).toBeNull()
  expect(refreshChatConnection(meta)).toEqual({ expired: true })
})

it('rejects metadata without a session and retains Channel approval checks', () => {
  expect(refreshChatConnection({ accountId: 'viewer', channelId: 'channel' })).toEqual({ expired: true })
  access.allowed = false
  expect(checkChatConnection(createChatConnectionToken(identity))).toBeNull()
  expect(refreshChatConnection(identity)).toEqual({ expired: true })
})
