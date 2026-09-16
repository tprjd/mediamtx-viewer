import { authorizeLiveChat } from '@/lib/chat-access'
import {
  applyChatBan,
  ChatModerationError,
  chatRemovalSchema,
} from '@/lib/chat-moderation'
import { requestChatOutboxDispatch } from '@/lib/chat-outbox'
import { readUtf8BodyWithLimit } from '@/lib/http-body'

export const dynamic = 'force-dynamic'
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
}

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
    if (
      !request.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('application/json')
    ) {
      throw new ChatModerationError(
        'Content-Type must be application/json.',
        415,
      )
    }
    const body = await readUtf8BodyWithLimit(request, 8192)
    if (body === null) throw new ChatModerationError('Invalid request.', 413)
    let value: unknown
    try {
      value = JSON.parse(body)
    } catch {
      throw new ChatModerationError('Invalid request.', 400)
    }
    const parsed = chatRemovalSchema.safeParse(value)
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
    return Response.json(
      {
        error:
          error instanceof ChatModerationError
            ? error.message
            : 'Chat is unavailable.',
      },
      {
        status: error instanceof ChatModerationError ? error.status : 503,
        headers,
      },
    )
  }
}
