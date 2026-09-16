import { getActiveSession } from '@/lib/auth/session'
import { isChatEnabled } from '@/lib/chat-environment'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const session = await getActiveSession()
  return Response.json(
    { enabled: Boolean(session) && isChatEnabled() },
    {
      status: session ? 200 : 401,
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    },
  )
}
