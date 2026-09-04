import { getRuntimeConfigurationErrors } from '@/lib/auth/env'
import { isDatabaseReady } from '@/lib/auth/store'
import { APP_VERSION } from '@/lib/app-version'

export const dynamic = 'force-dynamic'

export function GET() {
  const errors = getRuntimeConfigurationErrors()
  if (!isDatabaseReady()) errors.push('Authentication database is not migrated')

  return Response.json(
    errors.length === 0
      ? { status: 'ok', version: APP_VERSION }
      : { status: 'error', version: APP_VERSION, errors },
    { status: errors.length === 0 ? 200 : 503 },
  )
}
