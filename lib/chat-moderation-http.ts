import { ChatModerationError } from '@/lib/chat-moderation'
import { readUtf8BodyWithLimit } from '@/lib/http-body'

export const chatModerationHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
}

export function chatModerationFailure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof ChatModerationError
          ? error.message
          : 'Chat is unavailable.',
    },
    {
      status: error instanceof ChatModerationError ? error.status : 503,
      headers: chatModerationHeaders,
    },
  )
}

export async function readChatModerationBody(
  request: Request,
): Promise<unknown> {
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw new ChatModerationError('Content-Type must be application/json.', 415)
  const body = await readUtf8BodyWithLimit(request, 8192)
  if (body === null) throw new ChatModerationError('Invalid request.', 413)
  try {
    return JSON.parse(body)
  } catch {
    throw new ChatModerationError('Invalid request.', 400)
  }
}
