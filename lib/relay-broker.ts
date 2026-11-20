import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getDatabase } from '@/lib/auth/database'
import { getChannel } from '@/lib/channels'
import { getRegisteredRelay, getRelayCredential, RelayError, type RelayRegistration } from '@/lib/relay-credentials'
import { canWatchChannel } from '@/lib/viewing-access'

const LEASE_MS = 20_000
const ACCESS_CHECK_MS = 5_000
const COMMAND_TIMEOUT_MS = 12_000
const MAX_RELAYS = 256
const MAX_SESSIONS = 64
const MAX_COMMANDS = 8
const MAX_SDP_BYTES = 64 * 1024
const uuid = z.string().uuid()
export type RelayTransport = 'whep' | 'hls'
function validSdp(value: unknown, transport: RelayTransport): value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_SDP_BYTES || !/^v=0\r?\n/.test(value)) return false
  const lines = value.split(/\r?\n/).filter(line => line.startsWith('m='))
  if (transport === 'hls') return lines.length === 1 && /^m=application \d+ UDP\/DTLS\/SCTP webrtc-datachannel$/.test(lines[0])
  return lines.some(line => /^m=(audio|video) /.test(line))
}
const pollSchema = z.object({
  instanceId: uuid,
  hls: z.boolean().optional(),
  sessions: z.array(uuid).max(MAX_SESSIONS),
  replies: z.array(z.object({
    id: uuid, status: z.number().int().min(100).max(599),
    body: z.string().max(MAX_SDP_BYTES).optional(), localId: z.string().max(256).optional(),
  })).max(MAX_COMMANDS),
})

export interface RelayCommand {
  id: string
  method: 'POST' | 'PATCH' | 'DELETE'
  sessionId: string
  body?: string
  transport?: 'hls'
}

export interface RelayViewer {
  userId: string
  sessionId: string
}

interface ViewerSession extends RelayViewer {
  transport: RelayTransport
  viewerId: string
  active: boolean
  reported: boolean
  confirmedAt: number
}

interface Pending {
  command: RelayCommand
  sent: boolean
  finish(body: string, error?: RelayError): void
}

interface Relay extends RelayRegistration {
  hls: boolean
  instanceId: string
  lastSeen: number
  checkedAt: number
  sessions: Map<string, ViewerSession>
  jobs: Map<string, Pending>
  expiry: NodeJS.Timeout
}

// The viewer runs as one Node process. A restart invalidates all session grants.
const runtime = globalThis as typeof globalThis & { channelRelays?: Map<string, Relay> }
const relays = runtime.channelRelays ??= new Map<string, Relay>()

function closeSession(relay: Relay, id: string, error = new RelayError(410, 'Relay session closed.')) {
  relay.sessions.delete(id)
  for (const job of relay.jobs.values()) {
    if (job.command.sessionId === id) job.finish('', error)
  }
}

function removeRelay(relay: Relay) {
  clearTimeout(relay.expiry)
  relays.delete(relay.mediaPath)
  for (const id of relay.sessions.keys()) closeSession(relay, id, new RelayError(503, 'Relay disconnected.'))
}

function online(mediaPath: string): Relay | undefined {
  const relay = relays.get(mediaPath)
  if (relay && (Date.now() - relay.lastSeen >= LEASE_MS || getRegisteredRelay(mediaPath)?.generation !== relay.generation)) {
    removeRelay(relay)
    return
  }
  return relay
}

export function getRelayPlaybackState(mediaPath: string): 'online' | 'online-hls' | 'offline' {
  const relay = online(mediaPath)
  if (!relay) return 'offline'
  return relay.hls ? 'online-hls' : 'online'
}

export function getOnlineRelay(mediaPath: string): boolean {
  return Boolean(online(mediaPath))
}

export function getRelayViewerIds(mediaPath: string): string[] {
  const relay = online(mediaPath)
  if (!relay) return []
  const viewers = new Set<string>()
  for (const session of relay.sessions.values()) {
    if (session.active && session.reported) viewers.add(session.viewerId)
  }
  return [...viewers]
}

function allowed(slug: string, viewer: RelayViewer) {
  return Boolean(getDatabase().prepare('SELECT 1 FROM session WHERE id = ? AND userId = ? AND expiresAt > ?')
    .get(viewer.sessionId, viewer.userId, Date.now())) && canWatchChannel(viewer.userId, slug)
}

function relayForViewer(slug: string, viewer: RelayViewer) {
  if (!allowed(slug, viewer)) throw new RelayError(403, 'Viewing access is required.')
  const channel = getChannel(slug)
  const relay = channel && online(channel.mediaPath)
  if (!relay) throw new RelayError(503, 'Relay is offline.')
  return relay
}

function ownedSession(relay: Relay, id: string, viewer: RelayViewer) {
  const session = relay.sessions.get(id)
  if (!session || session.userId !== viewer.userId || session.sessionId !== viewer.sessionId) {
    throw new RelayError(404, 'Relay session not found.')
  }
  return session
}

function sendCommand(relay: Relay, method: 'POST' | 'PATCH', sessionId: string, body: string, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) { reject(new RelayError(408, 'Relay request cancelled.')); return }
    // The browser can send multiple ICE candidate PATCHes before the relay polls.
    if (relay.jobs.size >= MAX_SESSIONS || Array.from(relay.jobs.values()).filter(job => job.command.sessionId === sessionId).length >= MAX_COMMANDS) {
      reject(new RelayError(429, 'Relay request limit reached.'))
      return
    }
    const id = randomUUID()
    function finish(result: string, error?: RelayError) {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      relay.jobs.delete(id)
      if (error) reject(error)
      else resolve(result)
    }
    const abort = () => finish('', new RelayError(408, 'Relay request cancelled.'))
    const timeout = setTimeout(() => finish('', new RelayError(504, 'Relay did not answer in time.')), COMMAND_TIMEOUT_MS)
    timeout.unref()
    const command: RelayCommand = { id, method, sessionId, body }
    if (relay.sessions.get(sessionId)?.transport === 'hls') command.transport = 'hls'
    relay.jobs.set(id, { command, sent: false, finish })
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function createRelaySession(slug: string, viewer: RelayViewer, viewerId: string, offer: string, signal?: AbortSignal, transport: RelayTransport = 'whep') {
  if (!uuid.safeParse(viewerId).success || !validSdp(offer, transport)) throw new RelayError(400, 'Invalid relay offer or viewer identity.')
  const relay = relayForViewer(slug, viewer)
  if (transport === 'hls' && !relay.hls) throw new RelayError(503, 'HLS relay unavailable.')
  const accountSessions = Array.from(relay.sessions.values()).filter(s => s.userId === viewer.userId && s.transport === transport)
  const accountLimit = transport === 'hls' || viewer.userId === relay.ownerUserId ? 12 : 4
  if (relay.sessions.size >= MAX_SESSIONS || accountSessions.length >= accountLimit) {
    throw new RelayError(429, 'Relay session limit reached.')
  }
  const id = randomUUID()
  const session: ViewerSession = { ...viewer, transport, viewerId, active: false, reported: false, confirmedAt: 0 }
  relay.sessions.set(id, session)
  try {
    const answer = await sendCommand(relay, 'POST', id, offer, signal)
    if (relayForViewer(slug, viewer) !== relay || !relay.sessions.has(id)) throw new RelayError(410, 'Relay session closed.')
    session.active = true
    session.confirmedAt = Date.now()
    return { id, body: answer }
  } catch (error) {
    closeSession(relay, id)
    throw error
  }
}

export async function patchRelaySession(slug: string, viewer: RelayViewer, id: string, body: string, signal?: AbortSignal) {
  if (!body || Buffer.byteLength(body) > 16 * 1024) throw new RelayError(400, 'Invalid ICE fragment.')
  const relay = relayForViewer(slug, viewer)
  if (ownedSession(relay, id, viewer).transport !== 'whep') throw new RelayError(404, 'Session not found.')
  await sendCommand(relay, 'PATCH', id, body, signal)
}

export function deleteRelaySession(slug: string, viewer: RelayViewer, id: string): void {
  const relay = relayForViewer(slug, viewer)
  ownedSession(relay, id, viewer)
  closeSession(relay, id)
}

export function disconnectRelayViewers(userId?: string, mediaPath?: string): void {
  for (const relay of relays.values()) {
    if (mediaPath && relay.mediaPath !== mediaPath) continue
    for (const [id, session] of relay.sessions) {
      if (!userId || session.userId === userId) closeSession(relay, id)
    }
  }
}

export function pollRelay(credential: string, payload: unknown): {commands: RelayCommand[]; reset?: boolean} {
  const registration = getRelayCredential(credential)
  if (!registration) throw new RelayError(401, 'Relay credential rejected.')
  const parsed = pollSchema.safeParse(payload)
  if (!parsed.success) throw new RelayError(400, 'Invalid relay poll.')
  const { instanceId, replies, sessions } = parsed.data
  const now = Date.now()
  let relay = relays.get(registration.mediaPath)
  if (relay && (now - relay.lastSeen >= LEASE_MS || relay.generation !== registration.generation)) {
    removeRelay(relay)
    relay = undefined
  }
  if (relay && relay.instanceId !== instanceId) throw new RelayError(409, 'Another relay instance is active.')
  if (!relay) {
    // Reset an unknown process before accepting its lease; reset restarts MediaMTX with a new ID.
    if (sessions.length || replies.length) return { commands: [], reset: true }
    if (relays.size >= MAX_RELAYS) throw new RelayError(503, 'Relay limit reached.')
    const expiry = setTimeout(() => {
      const current = relays.get(registration.mediaPath)
      if (current?.expiry === expiry) removeRelay(current)
    }, LEASE_MS)
    expiry.unref()
    relay = { ...registration, hls: false, instanceId, lastSeen: now, checkedAt: now, sessions: new Map(), jobs: new Map(), expiry }
    relays.set(relay.mediaPath, relay)
  }
  relay.hls = parsed.data.hls === true
  relay.lastSeen = now
  relay.expiry.refresh()
  const reported = new Set(sessions)
  const checkAccess = now - relay.checkedAt >= ACCESS_CHECK_MS
  if (checkAccess) relay.checkedAt = now
  for (const [id, session] of relay.sessions) {
    session.reported = reported.has(id)
    if (checkAccess && !allowed(relay.channelSlug, session)) closeSession(relay, id)
    else if (session.reported) session.confirmedAt = now
    else if (session.active && now - session.confirmedAt >= ACCESS_CHECK_MS) closeSession(relay, id)
  }
  for (const reply of replies) {
    const job = relay.jobs.get(reply.id)
    if (!job?.sent) continue
    if (job.command.method === 'POST' && reply.status === 201 && validSdp(reply.body, job.command.transport ?? 'whep')) job.finish(reply.body)
    else if (job.command.method === 'PATCH' && reply.status === 204) job.finish('')
    else job.finish('', new RelayError(502, 'Local relay request failed.'))
  }
  const commands: RelayCommand[] = []
  // Reported resources without a current grant are closed on every poll until gone.
  for (const id of reported) {
    if (!relay.sessions.has(id)) commands.push({ id: randomUUID(), method: 'DELETE', sessionId: id })
    if (commands.length === MAX_COMMANDS) break
  }
  for (const job of relay.jobs.values()) {
    if (commands.length === MAX_COMMANDS) break
    if (job.sent) continue
    job.sent = true
    commands.push(job.command)
  }
  return { commands }
}
