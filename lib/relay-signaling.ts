import 'server-only'
import { randomUUID } from 'node:crypto'
import { getActiveSession } from '@/lib/auth/session'
import { canWatchChannel } from '@/lib/viewing-access'
import { readViewerId } from '@/lib/media-readers'
import { createRelaySession, deleteRelaySession, patchRelaySession, type RelayTransport } from '@/lib/relay-broker'
import { RelayError } from '@/lib/relay-credentials'
import { readRelaySdp, relayHeaders, relayStatus } from '@/lib/relay-http'

type Context = { params: Promise<{ slug: string; resource?: string[] }> }

export async function signalRelay(transport: RelayTransport, request: Request, context: Context): Promise<Response> {
  const { slug, resource = [] } = await context.params
  const create = request.method === 'POST' || request.method === 'OPTIONS'
  if (resource.length !== (create ? 0 : 1)) return relayStatus(404)

  try {
    const session = await getActiveSession(request.headers)
    if (!session) return relayStatus(401)
    if (!canWatchChannel(session.user.id, slug)) return relayStatus(403)
    const identity = { userId: session.user.id, sessionId: session.session.id }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        ...relayHeaders, Link: '<stun:stun.cloudflare.com:3478>; rel="ice-server"',
        'Accept-Patch': 'application/trickle-ice-sdpfrag',
      } })
    }
    if (request.method === 'DELETE') {
      deleteRelaySession(slug, identity, resource[0])
      return relayStatus(204)
    }
    const body = await readRelaySdp(request)
    if (body instanceof Response) return body
    if (request.method === 'PATCH') {
      await patchRelaySession(slug, identity, resource[0], body, request.signal)
      return relayStatus(204)
    }
    const viewerId = readViewerId(new URL(request.url).search) ?? randomUUID()
    const answer = await createRelaySession(slug, identity, viewerId, body, request.signal, transport)
    return new Response(answer.body, { status: 201, headers: {
      ...relayHeaders, 'Content-Type': 'application/sdp',
      Location: `/api/channels/${encodeURIComponent(slug)}/relay/${transport}/${answer.id}`,
    } })
  } catch (error) {
    return relayStatus(error instanceof RelayError ? error.status : 503)
  }
}
