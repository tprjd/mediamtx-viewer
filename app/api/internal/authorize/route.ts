import { timingSafeEqual } from 'node:crypto'

import { authEnvironment, getRuntimeConfigurationErrors } from '@/lib/auth/env'
import { authorizeMediaRequest } from '@/lib/media-authorization'

export const dynamic = 'force-dynamic'

function secretsMatch(received: string | null): boolean {
  if (!received || !authEnvironment.internalSecret) return false
  const expected = Buffer.from(authEnvironment.internalSecret)
  const actual = Buffer.from(received)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function safeReturnTo(value: string | null): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/'
  return value
}

export async function GET(request: Request) {
  if (!secretsMatch(request.headers.get('x-internal-auth'))) {
    return new Response(null, { status: 404 })
  }
  if (getRuntimeConfigurationErrors().length > 0) {
    return new Response(null, { status: 503 })
  }

  const originalMethod = request.headers.get('x-forwarded-method')
  const originalUri = request.headers.get('x-forwarded-uri') ?? '/'
  const access = await authorizeMediaRequest(request.headers, originalMethod, originalUri)
  if (access.status === 503) {
    // A failed access check must not become a sign-in redirect or an expiry claim.
    return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  if (access.status === 403) return new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  if (access.status === 204) {
    return new Response(null, {
      status: 204,
      headers: {
        'Cache-Control': 'no-store',
        'X-Authenticated-User': access.userId,
        'X-Authenticated-Role': access.role,
      },
    })
  }

  const destination = request.headers.get('sec-fetch-dest')
  if (destination === 'document' && originalMethod === 'GET') {
    const returnTo = safeReturnTo(originalUri)
    return new Response(null, {
      status: 307,
      headers: { Location: `/login?returnTo=${encodeURIComponent(returnTo)}` },
    })
  }

  return new Response(null, {
    status: 401,
    headers: { 'Cache-Control': 'no-store' },
  })
}
