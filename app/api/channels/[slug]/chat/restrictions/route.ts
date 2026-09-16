import { z } from 'zod'
import { authorizeLiveChat } from '@/lib/chat-access'
import {
  ChatModerationError,
  listActiveChatRestrictions,
  reverseChatRestriction,
} from '@/lib/chat-moderation'
import {
  chatModerationFailure,
  chatModerationHeaders as headers,
  readChatModerationBody,
} from '@/lib/chat-moderation-http'
import { requestChatOutboxDispatch } from '@/lib/chat-outbox'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ slug: string }> }

export async function GET(_request: Request, context: Context) {
  try {
    const access = await authorizeLiveChat((await context.params).slug)
    if (!access.ok)
      return Response.json(
        { error: access.error },
        { status: access.status, headers },
      )
    return Response.json(
      {
        restrictions: listActiveChatRestrictions(
          access.channel,
          access.accountId,
        ),
      },
      { headers },
    )
  } catch (error) {
    return chatModerationFailure(error)
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const access = await authorizeLiveChat((await context.params).slug)
    if (!access.ok)
      return Response.json(
        { error: access.error },
        { status: access.status, headers },
      )
    const parsed = z
      .object({ restrictionId: z.string().uuid() })
      .safeParse(await readChatModerationBody(request))
    if (!parsed.success)
      throw new ChatModerationError('Invalid restriction.', 400)
    reverseChatRestriction(
      access.channel,
      access.accountId,
      parsed.data.restrictionId,
    )
    requestChatOutboxDispatch()
    return Response.json({ ok: true }, { headers })
  } catch (error) {
    return chatModerationFailure(error)
  }
}
