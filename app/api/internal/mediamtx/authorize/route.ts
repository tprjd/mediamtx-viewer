import { timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

import { authEnvironment } from '@/lib/auth/env'
import { authorizePublish } from '@/lib/channels'

const requestSchema = z
  .object({
    action: z.enum(['publish', 'read', 'playback', 'api', 'metrics', 'pprof']),
    path: z.string().max(160).default(''),
    token: z.string().max(256).default(''),
  })
  .passthrough()

function secretMatches(provided: string | null): boolean {
  if (!provided || !authEnvironment.mediaMtxAuthSecret) return false
  const actual = Buffer.from(authEnvironment.mediaMtxAuthSecret)
  const candidate = Buffer.from(provided)
  return actual.length === candidate.length && timingSafeEqual(actual, candidate)
}

export async function POST(request: Request): Promise<Response> {
  if (!secretMatches(new URL(request.url).searchParams.get('secret'))) {
    return new Response(null, { status: 404 })
  }

  let payload: z.infer<typeof requestSchema>
  try {
    payload = requestSchema.parse(await request.json())
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (payload.action === 'publish') {
    return new Response(null, {
      status: authorizePublish(payload.path, payload.token) ? 204 : 401,
    })
  }

  if (payload.action === 'read' || payload.action === 'playback' || payload.action === 'api') {
    return new Response(null, { status: 204 })
  }

  return new Response(null, { status: 403 })
}
