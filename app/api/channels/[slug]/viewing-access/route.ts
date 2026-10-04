import { getActiveSession } from '@/lib/auth/session'
import { hasVerifiedOrLegacyAccountAccess, canSeeChannel, canWatchChannel } from '@/lib/viewing-access'
import { getViewingRequest } from '@/lib/viewing-requests'
export const dynamic = 'force-dynamic'
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await getActiveSession()
  const { slug } = await params
  const headers = { 'Cache-Control': 'private, no-store' }
  if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401, headers })
  if (!canSeeChannel(session.user.id, slug)) return Response.json({ error: 'Channel not found.' }, { status: 404, headers })
  return Response.json({ allowed: canWatchChannel(session.user.id, slug), canRequest: hasVerifiedOrLegacyAccountAccess(session.user.id), request: getViewingRequest(session.user.id, slug) ?? null, now: Date.now() }, { headers })
}
