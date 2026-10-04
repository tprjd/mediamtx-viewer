import { getActiveSession } from '@/lib/auth/session'
import { listNotifications } from '@/lib/viewing-requests'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  const before = Number(new URL(request.url).searchParams.get('before') ?? Number.MAX_SAFE_INTEGER)
  if (!Number.isSafeInteger(before) || before < 1) return Response.json({ error: 'Invalid notification cursor.' }, { status: 400 })
  const session = await getActiveSession()
  return Response.json(session ? listNotifications(session.user.id, before) : { error: 'Sign in required.' }, { status: session ? 200 : 401, headers: { 'Cache-Control': 'private, no-store' } })
}
