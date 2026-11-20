import 'server-only'

import { getChannel } from '@/lib/channels'
import { getChannelStatus } from '@/lib/mediamtx'
import { getRelayCredential, RelayError, type RelayRegistration } from '@/lib/relay-credentials'
import { relayBearer, relayHeaders, relayStatus } from '@/lib/relay-http'
import { isWhipPilotChannel } from '@/lib/whip-pilot'

const objectName = /^[a-f0-9]{12}_(?:audio|video)[1-9]\d{0,3}_(?:seg|part)\d{1,20}\.mp4$/
const maximumBytes = 16 * 1024 * 1024
type Rendition = 'primary' | 'fallback'
type Session = { directory: URL; cookie: string }
type Entry = { session: Promise<Session>; prefix: string; opened: number; used: number }
const sessions = new Map<string, Entry>()
let activeReads = 0

function allowedPath(relay: RelayRegistration, rendition: Rendition) {
  return rendition === 'primary' ? relay.mediaPath : getChannel(relay.channelSlug)?.fallbackMediaPath
}

async function openSession(relay: RelayRegistration, rendition: Rendition, path: string): Promise<Session> {
  if (rendition === 'primary' && isWhipPilotChannel(relay.channelSlug)) {
    const status = await getChannelStatus(path)
    if (!status.live) throw new RelayError(503, 'Media source unavailable.')
    path = status.hlsMediaPath ?? path
  }
  const directory = new URL(process.env.MEDIAMTX_HLS_URL ?? 'http://127.0.0.1:8888')
  directory.pathname = '/' + path.split('/').map(encodeURIComponent).join('/') + '/'
  const master = new URL('index.m3u8?cookieCheck=1&frankerzspam_internal=relay', directory)
  const response = await fetch(master, { headers: { Cookie: 'cookieCheck=1' }, cache: 'no-store',
    redirect: 'error', signal: AbortSignal.timeout(7000) })
  await response.body?.cancel()
  if (response.status !== 200) throw new RelayError(response.status === 404 ? 404 : 502, 'Media session unavailable.')
  const cookie = /^(hlsSession=[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12});/.exec(response.headers.get('set-cookie') ?? '')?.[1]
  if (!cookie) throw new RelayError(502, 'Missing media session.')
  return { directory, cookie }
}

function getSession(relay: RelayRegistration, rendition: Rendition, path: string, key: string, prefix: string): Entry {
  const now = Date.now()
  for (const [id, entry] of sessions) if (now - entry.used >= 25_000) sessions.delete(id)
  const cached = sessions.get(key)
  // A publisher restart creates a new muxer prefix. Limit reopens for stale or unknown objects.
  if (cached && (cached.prefix === prefix || now - cached.opened < 3000)) {
    cached.used = now
    return cached
  }
  if (!cached && sessions.size >= 128) throw new RelayError(503, 'Media session capacity reached.')
  const entry = { session: openSession(relay, rendition, path), prefix, opened: now, used: now }
  sessions.set(key, entry)
  entry.session.catch(() => { if (sessions.get(key) === entry) sessions.delete(key) })
  return entry
}

async function readObject(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) throw new RelayError(502, 'Empty media response.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximumBytes) {
        await reader.cancel()
        throw new RelayError(413, 'Media object is too large.')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  if (!size) throw new RelayError(502, 'Empty media response.')
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return body
}

export async function readRelayHlsObject(request: Request, rendition: string, object: string): Promise<Response> {
  const bearer = relayBearer(request)
  const relay = getRelayCredential(bearer)
  if (!relay) return relayStatus(401)
  if ((rendition !== 'primary' && rendition !== 'fallback') || !objectName.test(object)) return relayStatus(404)
  if (new URL(request.url).search) return relayStatus(400)
  if (request.headers.has('range')) return relayStatus(416)
  if (activeReads >= 8) return relayStatus(503)
  activeReads++
  try {
    const path = allowedPath(relay, rendition)
    if (!path) return relayStatus(404)
    const key = relay.generation + '/' + rendition + '/' + path
    const entry = getSession(relay, rendition, path, key, object.slice(0, 12))
    const { directory, cookie } = await entry.session
    const response = await fetch(new URL(object, directory), { headers: { Cookie: cookie }, cache: 'no-store',
      redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]) })
    if (response.status !== 200 || !['audio/mp4', 'video/mp4'].includes(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel()
      if (response.status === 401 && sessions.get(key) === entry) sessions.delete(key)
      return relayStatus(response.status === 404 ? 404 : 502)
    }
    const body = await readObject(response)
    const current = getRelayCredential(bearer)
    if (current?.generation !== relay.generation || allowedPath(current, rendition) !== path) return relayStatus(401)
    return new Response(body, { headers: { ...relayHeaders, 'Content-Type': response.headers.get('content-type')!,
      'Content-Length': String(body.byteLength), 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    return relayStatus(error instanceof RelayError ? error.status : 502)
  } finally { activeReads-- }
}
