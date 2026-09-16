import { authorizeLiveChat } from '@/lib/chat-access'
import {
  applyChatBan,
  ChatModerationError,
  chatRemovalSchema,
} from '@/lib/chat-moderation'
import {
  chatModerationFailure,
  chatModerationHeaders as headers,
  readChatModerationBody,
} from '@/lib/chat-moderation-http'
import { requestChatOutboxDispatch } from '@/lib/chat-outbox'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string; messageId: string }> },
) {
  try {
    const { slug, messageId } = await context.params
    const access = await authorizeLiveChat(slug)
    if (!access.ok)
      return Response.json(
        { error: access.error },
        { status: access.status, headers },
      )
    const parsed = chatRemovalSchema.safeParse(
      await readChatModerationBody(request),
    )
    if (!parsed.success)
      throw new ChatModerationError(
        'Select a category. Other requires a private note of at most 2000 characters.',
        400,
      )
    const result = applyChatBan({
      channel: access.channel,
      actorId: access.accountId,
      messageId,
      ...parsed.data,
    })
    requestChatOutboxDispatch()
    return Response.json(result, { headers })
  } catch (error) {
    return chatModerationFailure(error)
  }
}
