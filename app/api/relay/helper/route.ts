import { getRelayCredential } from '@/lib/relay-credentials'
import { relayHelperBinary, relayHelperHash } from '@/lib/relay-helper'
import { relayBearer, relayStatus } from '@/lib/relay-http'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  if (!getRelayCredential(relayBearer(request))) return relayStatus(401)
  const digest = relayHelperHash()
  if (!digest || new URL(request.url).searchParams.get('sha256') !== digest) return relayStatus(404)
  return new Response(new Uint8Array(relayHelperBinary()), {
    headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, no-store' },
  })
}
