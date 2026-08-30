import { timingSafeEqual } from 'node:crypto'

import { auth } from '@/lib/auth/auth'
import { authEnvironment, getRuntimeConfigurationErrors } from '@/lib/auth/env'
import { getUserStatus } from '@/lib/auth/store'

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

  const session = await auth.api.getSession({ headers: request.headers })
  if (session && getUserStatus(session.user.id) === 'active') {
    return new Response(null, {
      status: 204,
      headers: {
        'X-Authenticated-User': session.user.id,
        'X-Authenticated-Role': session.user.role ?? 'user',
      },
    })
  }

  const destination = request.headers.get('sec-fetch-dest')
  const originalMethod = request.headers.get('x-forwarded-method')
  if (destination === 'document' && originalMethod === 'GET') {
    const returnTo = safeReturnTo(request.headers.get('x-forwarded-uri'))
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

