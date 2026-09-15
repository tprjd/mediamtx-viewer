import { authorizeLiveChat } from '@/lib/chat-access'
import { getChatParticipantState } from '@/lib/chat-moderation'

export const dynamic = 'force-dynamic'
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params
    const access = await authorizeLiveChat(slug)
    if (!access.ok)
      return Response.json(
        { error: access.error },
        { status: access.status, headers },
      )
    return Response.json(
      getChatParticipantState(access.channel, access.accountId),
      { headers },
    )
  } catch {
    return Response.json(
      { error: 'Chat is unavailable.' },
      { status: 503, headers },
    )
  }
}
