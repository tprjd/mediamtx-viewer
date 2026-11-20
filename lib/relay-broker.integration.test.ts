// @vitest-environment node
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createRelaySession, deleteRelaySession, disconnectRelayViewers, getOnlineRelay,
  getRelayViewerIds, patchRelaySession, pollRelay,
} from './relay-broker'
import {
  completeRelaySourceRevocation, getPairedRelayPaths, getRelayCredential, getRelayCredentialStatus, issueRelayPairingTicket,
  pendingRelaySourceRevocations,
  redeemRelayPairingTicket, revokeRelayCredential,
} from './relay-credentials'
import { authorizePublish, createOrRotateStreamKey } from './channels'

vi.mock('server-only', () => ({}))
let db: Database.Database
vi.mock('@/lib/auth/database', () => ({ getDatabase: () => db }))
const viewer = { userId: 'viewer', sessionId: 'signed-in-viewer' }
const other = { userId: 'other', sessionId: 'signed-in-other' }
const sdp = 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'
const migrations = readdirSync('migrations').filter(f => f.endsWith('.sql')).sort().map(f => readFileSync('migrations/' + f, 'utf8'))

beforeEach(() => {
  vi.useFakeTimers()
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  for (const migration of migrations) db.exec(migration)
  for (const id of ['owner', viewer.userId, other.userId]) {
    db.prepare(`INSERT INTO user (id,name,email,emailVerified,administratorApproved,createdAt,updatedAt,activationStatus)
      VALUES (?, ?, ?, 1, 1, 0, 0, 'active')`).run(id, id, id + '@example.test')
    db.prepare('INSERT INTO session (id,token,userId,createdAt,updatedAt,expiresAt) VALUES (?,?,?,0,0,?)')
      .run('signed-in-' + id, 'token-' + id, id, Date.now() + 60 * 60_000)
  }
})

afterEach(() => {
  vi.advanceTimersByTime(20_001)
  vi.useRealTimers()
  db.close()
})

function connect() {
  const {credential,channelSlug,mediaPath} = redeemRelayPairingTicket(issueRelayPairingTicket('owner'))
  const instanceId = randomUUID()
  function poll(sessions: string[] = [], replies: {id: string; status: number; body?: string}[] = []) {
    return pollRelay(credential, {instanceId, sessions, replies})
  }
  poll()
  return {credential,channelSlug,mediaPath,instanceId,poll}
}

it('consumes tickets once, stores only hashes, replaces only the relay credential and supports revocation', () => {
  const key = createOrRotateStreamKey('owner')
  const ticket = issueRelayPairingTicket('owner')
  const first = redeemRelayPairingTicket(ticket)
  const row = db.prepare('SELECT * FROM channel_relay').get()
  expect(JSON.stringify(row)).not.toContain(first.credential)
  expect(JSON.stringify(row)).not.toContain(ticket)
  expect(() => redeemRelayPairingTicket(ticket)).toThrow(/ticket/)
  const secondTicket = issueRelayPairingTicket('owner')
  const firstGrant = getRelayCredential(first.credential)!
  expect(firstGrant.channelSlug).toBe(first.channelSlug)
  const next = redeemRelayPairingTicket(secondTicket)
  const nextGrant = getRelayCredential(next.credential)!
  expect(pendingRelaySourceRevocations()).toEqual([{generation:firstGrant.generation,mediaPath:first.mediaPath}])
  completeRelaySourceRevocation(firstGrant.generation)
  expect(getRelayCredential(first.credential)).toBeNull()
  expect(getPairedRelayPaths()).toEqual(new Set([first.mediaPath]))
  expect(getRelayCredentialStatus('owner')).toBe(true)
  expect(authorizePublish(first.mediaPath, key.token)).toBe(true)
  const unused = issueRelayPairingTicket('owner')
  revokeRelayCredential('owner')
  expect(pendingRelaySourceRevocations()).toEqual([{generation:nextGrant.generation,mediaPath:first.mediaPath}])
  expect(() => redeemRelayPairingTicket(unused)).toThrow(/ticket/)
  expect(getRelayCredential(next.credential)).toBeNull()
  expect(getRelayCredentialStatus('owner')).toBe(false)
})

it('rejects expired and superseded tickets, disabled channels and suspended owners', () => {
  const old = issueRelayPairingTicket('owner')
  const current = issueRelayPairingTicket('owner')
  expect(() => redeemRelayPairingTicket(old)).toThrow(/ticket/)
  vi.advanceTimersByTime(10 * 60_000)
  expect(() => redeemRelayPairingTicket(current)).toThrow(/ticket/)
  const {credential} = connect()
  db.prepare("UPDATE channel SET enabled=0 WHERE owner_user_id='owner'").run()
  expect(getRelayCredential(credential)).toBeNull()
  expect(() => issueRelayPairingTicket('owner')).toThrow(/enabled channel/)
  db.prepare("UPDATE channel SET enabled=1 WHERE owner_user_id='owner'").run()
  db.prepare("UPDATE user SET activationStatus='disabled' WHERE id='owner'").run()
  expect(getRelayCredential(credential)).toBeNull()
})

it('routes a WHEP offer and patch, restricts the resource to its login, and closes orphan sessions', async () => {
  const relay = connect()
  const viewerId = randomUUID()
  const created = createRelaySession(relay.channelSlug, viewer, viewerId, sdp)
  const [command] = relay.poll().commands
  expect(command).toMatchObject({method:'POST', body:sdp})
  expect(getRelayViewerIds(relay.mediaPath)).toEqual([])
  relay.poll([command.sessionId], [{id:command.id,status:201,body:sdp}])
  const {id} = await created
  expect(id).toBe(command.sessionId)
  expect(getRelayViewerIds(relay.mediaPath)).toEqual([viewerId])
  expect(() => deleteRelaySession(relay.channelSlug, other, id)).toThrow(/not found/)
  const patches = ['a=candidate:1', 'a=end-of-candidates'].map(fragment =>
    patchRelaySession(relay.channelSlug, viewer, id, fragment + '\r\n'))
  const ice = relay.poll([id]).commands
  expect(ice).toMatchObject([{method:'PATCH',sessionId:id}, {method:'PATCH',sessionId:id}])
  relay.poll([id], ice.map(command => ({id:command.id, status:204})))
  await Promise.all(patches)
  deleteRelaySession(relay.channelSlug, viewer, id)
  expect(relay.poll([id]).commands).toMatchObject([{method:'DELETE',sessionId:id}])
  expect(relay.poll([id]).commands).toMatchObject([{method:'DELETE',sessionId:id}])
  expect(relay.poll().commands).toHaveLength(0)
  expect(getRelayViewerIds(relay.mediaPath)).toEqual([])
})

it.each(['approval', 'login', 'suspension'])('cuts an existing session after loss of %s on the next access check', async reason => {
  const relay = connect()
  const create = createRelaySession(relay.channelSlug, viewer, randomUUID(), sdp)
  const [job] = relay.poll().commands
  const id = job.sessionId
  relay.poll([id],[{id:job.id,status:201,body:sdp}])
  await create
  if (reason === 'approval') db.prepare('UPDATE user SET administratorApproved=0 WHERE id=?').run(viewer.userId)
  if (reason === 'login') db.prepare('UPDATE session SET expiresAt=0 WHERE id=?').run(viewer.sessionId)
  if (reason === 'suspension') db.prepare("UPDATE user SET activationStatus='disabled' WHERE id=?").run(viewer.userId)
  vi.advanceTimersByTime(5_001)
  expect(relay.poll([id]).commands).toMatchObject([{method:'DELETE',sessionId:id}])
  expect(getRelayViewerIds(relay.mediaPath)).toEqual([])
})

it('cancels pending offers on revocation, rotation, and loss of the browser request', async () => {
  const relay = connect()
  const canceled = createRelaySession(relay.channelSlug, viewer, randomUUID(), sdp)
  const [job] = relay.poll().commands
  disconnectRelayViewers(viewer.userId, relay.mediaPath)
  await expect(canceled).rejects.toMatchObject({status:410})
  expect(relay.poll([job.sessionId],[{id:job.id,status:201,body:sdp}]).commands[0].method).toBe('DELETE')
  const abort = new AbortController()
  const disconnected = createRelaySession(relay.channelSlug, viewer, randomUUID(), sdp, abort.signal)
  abort.abort()
  await expect(disconnected).rejects.toMatchObject({status:408})
  const stale = createRelaySession(relay.channelSlug, viewer, randomUUID(), sdp)
  redeemRelayPairingTicket(issueRelayPairingTicket('owner'))
  expect(getOnlineRelay(relay.mediaPath)).toBe(false)
  await expect(stale).rejects.toMatchObject({status:503})
  expect(() => relay.poll()).toThrow(/credential/)
})

it('reconciles sessions after restart and leases only one local instance at a time', () => {
  const relay = connect()
  const next = () => pollRelay(relay.credential, {instanceId:randomUUID(),sessions:[randomUUID()],replies:[]})
  expect(next).toThrow(/another relay/i)
  vi.advanceTimersByTime(20_001)
  expect(getOnlineRelay(relay.mediaPath)).toBe(false)
  expect(next()).toEqual({commands:[],reset:true})
  expect(pollRelay(relay.credential, {instanceId:randomUUID(),sessions:[],replies:[]})).toEqual({commands:[]})
  expect(() => relay.poll()).toThrow(/another relay/i)
})

it('bounds input and in-flight resources, then releases offers whose replies were lost', async () => {
  const relay = connect()
  expect(() => pollRelay(relay.credential, {instanceId:relay.instanceId,sessions:Array(65).fill(randomUUID()),replies:[]})).toThrow(/invalid/i)
  await expect(createRelaySession(relay.channelSlug, viewer, randomUUID(), sdp + 'X'.repeat(65536))).rejects.toMatchObject({status:400})
  const batch = Array.from({length:4}, () => createRelaySession(relay.channelSlug, viewer, randomUUID(), sdp))
  await expect(createRelaySession(relay.channelSlug, viewer, randomUUID(), sdp)).rejects.toMatchObject({status:429})
  const jobs = relay.poll().commands
  expect(jobs).toHaveLength(4)
  vi.advanceTimersByTime(12_001)
  await Promise.all(batch.map(p => expect(p).rejects.toMatchObject({status:504})))
  const stale = jobs[0]
  expect(relay.poll([stale.sessionId], [{id:stale.id, status:201, body:sdp}]).commands[0]).toMatchObject({method:'DELETE',sessionId:stale.sessionId})
})
