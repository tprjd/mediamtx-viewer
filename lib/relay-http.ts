import 'server-only'
import { getRuntimeConfigurationErrors } from '@/lib/auth/env'
import { readUtf8BodyWithLimit } from '@/lib/http-body'
import { RelayError } from '@/lib/relay-credentials'

export const relayHeaders = { 'Cache-Control': 'private, no-store' }

export function relayStatus(status: number): Response {
  return new Response(null, { status, headers: relayHeaders })
}

export function relayBearer(request: Request): string {
  return /^Bearer ([A-Za-z0-9._-]{16,256})$/i.exec(request.headers.get('Authorization') ?? '')?.[1] ?? ''
}

export async function relayJson(request: Request, maxBytes: number, handle: (body: unknown) => unknown): Promise<Response> {
  if (getRuntimeConfigurationErrors().length) return relayStatus(503)
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return relayStatus(415)
  const raw = await readUtf8BodyWithLimit(request, maxBytes)
  if (raw === null) return relayStatus(413)
  try {
    const result = await handle(JSON.parse(raw))
    return Response.json(result, { headers: relayHeaders })
  } catch (error) {
    if (error instanceof SyntaxError) return relayStatus(400)
    return relayStatus(error instanceof RelayError ? error.status : 503)
  }
}

/** WHEP accepts an SDP offer or trickle ICE fragment, never an arbitrary HTTP body. */
export async function readRelaySdp(request: Request): Promise<string | Response> {
  const expected = request.method === 'PATCH' ? 'application/trickle-ice-sdpfrag' : 'application/sdp'
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== expected) return relayStatus(415)
  const text = await readUtf8BodyWithLimit(request, request.method === 'PATCH' ? 16 * 1024 : 64 * 1024)
  if (text === null) return relayStatus(413)
  return text || relayStatus(400)
}
