import { z } from 'zod'

import { authorizeLiveChat } from '@/lib/chat-access'
import {
  loadChatMessagesAfter,
  loadLatestChatMessages,
  sendChatMessage,
} from '@/lib/chat'
import { requestChatOutboxDispatch } from '@/lib/chat-outbox'
import { ChatMessageValidationError } from '@/lib/chat-rules'
import { readUtf8BodyWithLimit } from '@/lib/http-body'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ slug: string }>
}

const requestSchema = z.object({
  content: z.string(),
})
const responseHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
}

async function authorizeChatRequest(context: RouteContext) {
  const { slug } = await context.params
  const access = await authorizeLiveChat(slug)
  if (access.ok) return access
  return Response.json(
    { error: access.error },
    { status: access.status, headers: responseHeaders },
  )
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const access = await authorizeChatRequest(context)
  if (access instanceof Response) return access

  try {
    const after = new URL(request.url).searchParams.get('after')
    if (after !== null) {
      if (!/^\d+$/.test(after) || !Number.isSafeInteger(Number(after))) {
        return Response.json(
          { error: 'Invalid room sequence.' },
          { status: 400, headers: responseHeaders },
        )
      }
      return Response.json(loadChatMessagesAfter(access.channel, Number(after)), {
        headers: responseHeaders,
      })
    }
    return Response.json(
      { messages: loadLatestChatMessages(access.channel) },
      { headers: responseHeaders },
    )
  } catch {
    return Response.json(
      { error: 'Chat is unavailable.' },
      { status: 503, headers: responseHeaders },
    )
  }
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const access = await authorizeChatRequest(context)
  if (access instanceof Response) return access

  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return Response.json(
      { error: 'Content-Type must be application/json.' },
      { status: 415, headers: responseHeaders },
    )
  }

  const body = await readUtf8BodyWithLimit(request, 8192)
  if (body === null) {
    return Response.json(
      { error: 'Invalid request.' },
      { status: 413, headers: responseHeaders },
    )
  }
  const parsed = requestSchema.safeParse(
    (() => {
      try {
        return JSON.parse(body) as unknown
      } catch {
        return null
      }
    })(),
  )
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request.' },
      { status: 400, headers: responseHeaders },
    )
  }

  try {
    const message = sendChatMessage({
      channel: access.channel,
      participant: {
        accountId: access.accountId,
        profileName: access.profileName,
      },
      rawContent: parsed.data.content,
    })
    requestChatOutboxDispatch()
    return Response.json(
      { message },
      { status: 201, headers: responseHeaders },
    )
  } catch (error) {
    if (error instanceof ChatMessageValidationError) {
      return Response.json(
        { error: error.message },
        { status: 400, headers: responseHeaders },
      )
    }
    return Response.json(
      { error: 'Chat is unavailable.' },
      { status: 503, headers: responseHeaders },
    )
  }
}
