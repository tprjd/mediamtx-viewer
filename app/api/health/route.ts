import { getRuntimeConfigurationErrors } from '@/lib/auth/env'
import { isDatabaseReady } from '@/lib/auth/store'
import { getChatHealth } from '@/lib/chat-health'
import { APP_VERSION } from '@/lib/app-version'

export const dynamic = 'force-dynamic'

export async function GET() {
  const chat = await getChatHealth()
  const errors = getRuntimeConfigurationErrors()
  if (!isDatabaseReady()) errors.push('Authentication database is not migrated')

  return Response.json(
    errors.length === 0
      ? { status: 'ok', version: APP_VERSION, chat }
      : { status: 'error', version: APP_VERSION, errors, chat },
    { status: errors.length === 0 ? 200 : 503 },
  )
}
