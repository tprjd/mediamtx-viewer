import { z } from 'zod'

import { authEnvironment, getRuntimeConfigurationErrors } from '@/lib/auth/env'
import { readUtf8BodyWithLimit } from '@/lib/http-body'
import {
  enforceObsSetupPollRateLimit,
  hashObsSetupClientAddress,
  OBS_SETUP_POLL_INTERVAL_SECONDS,
  ObsSetupError,
  redeemObsSetupSession,
} from '@/lib/obs-setup'
import { disconnectChannelPublisher } from '@/lib/mediamtx'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({
  deviceSecret: z.string().trim().min(40).max(128),
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
      { status: 'error', error: 'OBS setup is temporarily unavailable.' },
      { status: 503, headers: responseHeaders },
    )
  }
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return Response.json(
      { status: 'error', error: 'Content-Type must be application/json.' },
      { status: 415, headers: responseHeaders },
    )
  }

  const body = await readUtf8BodyWithLimit(request, 1024)
  if (body === null) {
    return Response.json(
      { status: 'error', error: 'Invalid request.' },
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
      { status: 'error', error: 'Invalid request.' },
      { status: 400, headers: responseHeaders },
    )
  }

  try {
    enforceObsSetupPollRateLimit(
      hashObsSetupClientAddress(clientAddress(request)),
    )
    const result = redeemObsSetupSession(parsed.data.deviceSecret)
    let warning: string | undefined
    if (result.streamKey.rotated) {
      try {
        await disconnectChannelPublisher(result.streamKey.mediaPath)
      } catch {
        warning =
          'The old key was revoked, but the existing publisher could not be disconnected.'
      }
    }
    return Response.json(
      {
        status: 'authorized',
        serverUrl: `${authEnvironment.baseUrl}/publish/whip/${result.streamKey.mediaPath}/whip`,
        bearerToken: result.streamKey.token,
        warning: warning ?? null,
      },
      { headers: responseHeaders },
    )
  } catch (error) {
    if (error instanceof ObsSetupError) {
      if (error.code === 'pending') {
        return Response.json(
          {
            status: 'pending',
            interval: OBS_SETUP_POLL_INTERVAL_SECONDS,
          },
          { headers: responseHeaders },
        )
      }
      return Response.json(
        { status: error.code, error: error.message },
        {
          status:
            error.code === 'rate_limited'
              ? 429
              : error.code === 'expired'
                ? 410
                : error.code === 'denied'
                  ? 403
                  : error.code === 'unavailable'
                    ? 409
                    : 400,
          headers: {
            ...responseHeaders,
            ...(error.code === 'rate_limited'
              ? { 'Retry-After': String(OBS_SETUP_POLL_INTERVAL_SECONDS) }
              : {}),
          },
        },
      )
    }
    return Response.json(
      { status: 'error', error: 'OBS setup is temporarily unavailable.' },
      { status: 503, headers: responseHeaders },
    )
  }
}
