import { createHmac, timingSafeEqual } from 'node:crypto'
import { authEnvironment, getRuntimeConfigurationErrors } from '@/lib/auth/env'
import { getRelayCredential } from '@/lib/relay-credentials'
import { readRelaySdp, relayBearer, relayHeaders, relayStatus } from '@/lib/relay-http'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ resource?: string[] }> }
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

// Bind each upstream WHEP resource to the particular pairing that opened it.
function signature(generation: string, path: string, id: string): string {
  return createHmac('sha256', authEnvironment.internalSecret).update(JSON.stringify([generation, path, id])).digest('base64url')
}

async function source(request: Request, context: Context): Promise<Response> {
  if (getRuntimeConfigurationErrors().length) return relayStatus(503)
  const credential = relayBearer(request)
  const relay = credential && getRelayCredential(credential)
  if (!relay) return relayStatus(401)
  const { resource = [] } = await context.params
  const initial = request.method === 'POST' || request.method === 'OPTIONS'
  if (resource.length !== (initial ? 0 : 1)) return relayStatus(404)
  const path = '/' + relay.mediaPath.split('/').map(encodeURIComponent).join('/') + '/whep'
  const target = new URL(path, process.env.MEDIAMTX_WEBRTC_URL ?? 'http://127.0.0.1:8889')
  if (initial) {
    target.searchParams.set('frankerzspam_internal', 'relay')
    target.searchParams.set('relay_generation', relay.generation)
  } else {
    const [id, tag, extra] = resource[0].split('.')
    if (extra !== undefined || !uuid.test(id) || !/^[\w-]{43}$/.test(tag ?? '')) return relayStatus(404)
    if (!timingSafeEqual(Buffer.from(tag), Buffer.from(signature(relay.generation, path, id)))) return relayStatus(404)
    target.pathname += '/' + id
  }

  const headers = new Headers()
  let body: string | undefined
  if (request.method === 'POST' || request.method === 'PATCH') {
    const sdp = await readRelaySdp(request)
    if (sdp instanceof Response) return sdp
    body = sdp
    headers.set('Content-Type', request.headers.get('Content-Type')!)
    const tag = request.headers.get('If-Match')
    if (tag) headers.set('If-Match', tag)
  }
  try {
    const response = await fetch(target, {
      method: request.method, headers, body, cache: 'no-store', redirect: 'manual',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    })
    if (!response.ok) return relayStatus(response.status >= 400 ? response.status : 502)
    const out = new Headers(relayHeaders)
    for (const name of ['Content-Type', 'ETag', 'Link', 'Accept-Patch']) {
      const value = response.headers.get(name)
      if (value) out.set(name, value)
    }
    if (request.method === 'POST') {
      const location = response.headers.get('Location')
      const session = location && new URL(location, target)
      const id = session && session.pathname.slice(path.length + 1)
      if (response.status !== 201 || !session || session.origin !== target.origin ||
          !session.pathname.startsWith(path + '/') || !id || !uuid.test(id)) return relayStatus(502)
      if (getRelayCredential(credential)?.generation !== relay.generation) {
        await fetch(session, { method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(3000) })
        return relayStatus(401)
      }
      out.set('Location', '/api/relay/source/whep/' + id + '.' + signature(relay.generation, path, id))
    }
    return new Response(response.body, { status: response.status, headers: out })
  } catch {
    return relayStatus(502)
  }
}

export { source as OPTIONS, source as POST, source as PATCH, source as DELETE }
