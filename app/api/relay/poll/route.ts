import { pollRelay } from '@/lib/relay-broker'
import { relayBearer, relayJson, relayStatus } from '@/lib/relay-http'

export async function POST(request: Request) {
  const credential = relayBearer(request)
  if (!credential) return relayStatus(401)
  return relayJson(request, 512 * 1024, body => pollRelay(credential, body))
}
