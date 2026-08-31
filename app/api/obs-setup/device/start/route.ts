import { z } from 'zod'

import { authEnvironment, getRuntimeConfigurationErrors } from '@/lib/auth/env'
import { readUtf8BodyWithLimit } from '@/lib/http-body'
import {
  createObsSetupSession,
  hashObsSetupClientAddress,
  OBS_SETUP_EXPIRES_MS,
  OBS_SETUP_POLL_INTERVAL_SECONDS,
  ObsSetupError,
} from '@/lib/obs-setup'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({
  scriptVersion: z.string().trim().min(1).max(32),
})

const responseHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
}

function clientAddress(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

export async function POST(request: Request): Promise<Response> {
  if (getRuntimeConfigurationErrors().length > 0) {
    return Response.json(
      { error: 'OBS setup is temporarily unavailable.' },
      { status: 503, headers: responseHeaders },
    )
  }
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return Response.json(
      { error: 'Content-Type must be application/json.' },
      { status: 415, headers: responseHeaders },
    )
  }

  const body = await readUtf8BodyWithLimit(request, 1024)
  if (body === null) {
    return Response.json(
      { error: 'Invalid request.' },
      { status: 413, headers: responseHeaders },
    )
  }
  const parsed = requestSchema.safeParse(
    (() => {
      try {
        return JSON.parse(body) as unknown
      } catch {
        return null
      }
    })(),
  )
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request.' },
      { status: 400, headers: responseHeaders },
    )
  }

  try {
    const session = createObsSetupSession(
      hashObsSetupClientAddress(clientAddress(request)),
      parsed.data.scriptVersion,
    )
    return Response.json(
      {
        status: 'pending',
        deviceSecret: session.deviceSecret,
        userCode: session.userCode,
        verificationUrl: `${authEnvironment.baseUrl}/account/channel/obs-setup/${encodeURIComponent(session.userCode)}`,
        expiresIn: Math.floor(OBS_SETUP_EXPIRES_MS / 1000),
        interval: OBS_SETUP_POLL_INTERVAL_SECONDS,
      },
      { headers: responseHeaders },
    )
  } catch (error) {
    if (error instanceof ObsSetupError) {
      return Response.json(
        { error: error.message, code: error.code },
        {
          status:
            error.code === 'rate_limited'
              ? 429
              : error.code === 'unsupported_version'
                ? 409
                : 503,
          headers: responseHeaders,
        },
      )
    }
    return Response.json(
      { error: 'OBS setup is temporarily unavailable.' },
      { status: 503, headers: responseHeaders },
    )
  }
}
