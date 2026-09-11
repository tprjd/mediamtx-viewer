import { authorizeLiveChat } from '@/lib/chat-access'
import { createChatConnectionToken } from '@/lib/chat-realtime'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ slug: string }>
}

const responseHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { slug } = await context.params
  const access = await authorizeLiveChat(slug)
  if (!access.ok) {
    return Response.json(
      { error: access.error },
      { status: access.status, headers: responseHeaders },
    )
  }
  return Response.json(
    {
      token: createChatConnectionToken({
        accountId: access.accountId,
        channelId: access.channel.id,
      }),
    },
    { headers: responseHeaders },
  )
}
