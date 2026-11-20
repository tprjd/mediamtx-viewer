import { redeemRelayPairingTicket } from '@/lib/relay-credentials'
import { relayJson } from '@/lib/relay-http'

export async function POST(request: Request) {
  return relayJson(request, 1024, body => {
    const ticket = body && typeof body === 'object' && 'ticket' in body ? body.ticket : undefined
    return redeemRelayPairingTicket(typeof ticket === 'string' ? ticket : '')
  })
}
