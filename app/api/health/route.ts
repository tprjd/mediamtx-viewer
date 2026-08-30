import { getRuntimeConfigurationErrors } from '@/lib/auth/env'
import { isDatabaseReady } from '@/lib/auth/store'

export const dynamic = 'force-dynamic'

export function GET() {
  const errors = getRuntimeConfigurationErrors()
  if (!isDatabaseReady()) errors.push('Authentication database is not migrated')

  return Response.json(
    errors.length === 0 ? { status: 'ok' } : { status: 'error', errors },
    { status: errors.length === 0 ? 200 : 503 },
  )
}

