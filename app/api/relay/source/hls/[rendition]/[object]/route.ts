import { getRuntimeConfigurationErrors } from '@/lib/auth/env'
import { readRelayHlsObject } from '@/lib/relay-hls-source'
import { relayStatus } from '@/lib/relay-http'

type Context = { params: Promise<{ rendition: string; object: string }> }

export async function GET(request: Request, context: Context): Promise<Response> {
  if (getRuntimeConfigurationErrors().length) return relayStatus(503)
  const { rendition, object } = await context.params
  return readRelayHlsObject(request, rendition, object)
}
