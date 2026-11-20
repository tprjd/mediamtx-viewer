import { authEnvironment } from '@/lib/auth/env'
import { getActiveSession } from '@/lib/auth/session'
import { issueRelayPairingTicket, RelayError } from '@/lib/relay-credentials'
import { buildRelayInstaller, RELAY_INSTALLER_FILENAME } from '@/lib/relay-installer'
import { relayHeaders, relayStatus } from '@/lib/relay-http'

export async function POST(request: Request): Promise<Response> {
  const origin = new URL(authEnvironment.baseUrl).origin
  if (request.headers.get('Origin') !== origin) return relayStatus(403)
  const session = await getActiveSession(request.headers)
  if (!session) return relayStatus(401)
  try {
    const ticket = issueRelayPairingTicket(session.user.id)
    const file = buildRelayInstaller({ origin, ticket })
    return new Response(new Uint8Array(file), { headers: {
      ...relayHeaders, 'Content-Disposition': `attachment; filename="${RELAY_INSTALLER_FILENAME}"`,
      'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff',
    } })
  } catch (error) {
    return relayStatus(error instanceof RelayError ? error.status : 503)
  }
}
