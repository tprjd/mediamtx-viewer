import { authorizeLiveChat } from '@/lib/chat-access'
import {
  ChatModerationError,
  getChatMessageActions,
  chatRemovalSchema,
  inspectRemovedChatMessage,
  removeChatMessage,
} from '@/lib/chat-moderation'
import { requestChatOutboxDispatch } from '@/lib/chat-outbox'
import { readUtf8BodyWithLimit } from '@/lib/http-body'

export const dynamic = 'force-dynamic'
interface RouteContext {
  params: Promise<{ slug: string; messageId: string }>
}
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
}

function failure(error: unknown) {
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

export async function GET(request: Request, context: RouteContext) {
  try {
    const { slug, messageId } = await context.params
    const access = await authorizeLiveChat(slug)
    if (!access.ok)
      return Response.json(
        { error: access.error },
        { status: access.status, headers },
      )
    if (new URL(request.url).searchParams.get('permissions') === '1') {
      return Response.json(
        getChatMessageActions(access.channel, access.accountId, messageId),
        { headers },
      )
    }
    return Response.json(
      inspectRemovedChatMessage(access.channel, access.accountId, messageId),
      { headers },
    )
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: Request, context: RouteContext) {
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
    const message = removeChatMessage({
      channel: access.channel,
      actorId: access.accountId,
      messageId,
      ...parsed.data,
    })
    requestChatOutboxDispatch()
    return Response.json({ message }, { headers })
  } catch (error) {
    return failure(error)
  }
}
