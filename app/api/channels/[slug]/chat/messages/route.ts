import { z } from 'zod'

import { getActiveSession } from '@/lib/auth/session'
import { getUserById } from '@/lib/auth/store'
import { getChatChannel, type ChatChannel } from '@/lib/channels'
import { loadLatestChatMessages, sendChatMessage } from '@/lib/chat'
import {
  getChatRuntimeConfigurationErrors,
  isChatEnabled,
} from '@/lib/chat-environment'
import { ChatMessageValidationError } from '@/lib/chat-rules'
import { readUtf8BodyWithLimit } from '@/lib/http-body'
import { getChannelStatus } from '@/lib/mediamtx'

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

async function authorizeChatRequest(
  context: RouteContext,
): Promise<
  | { channel: ChatChannel; accountId: string; profileName: string }
  | Response
> {
  if (!isChatEnabled()) {
    return Response.json(
      { error: 'Not found' },
      { status: 404, headers: responseHeaders },
    )
  }
  if (getChatRuntimeConfigurationErrors().length > 0) {
    return Response.json(
      { error: 'Chat is unavailable.' },
      { status: 503, headers: responseHeaders },
    )
  }

  const session = await getActiveSession()
  if (!session) {
    return Response.json(
      { error: 'An active account is required.' },
      { status: 401, headers: responseHeaders },
    )
  }

  const account = getUserById(session.user.id)
  if (!account || account.activationStatus !== 'active') {
    return Response.json(
      { error: 'An active account is required.' },
      { status: 401, headers: responseHeaders },
    )
  }

  const { slug } = await context.params
  const channel = getChatChannel(slug)
  if (!channel) {
    return Response.json(
      { error: 'Channel not found.' },
      { status: 404, headers: responseHeaders },
    )
  }

  const status = await getChannelStatus(channel.mediaPath)
  if (!status.live) {
    return Response.json(
      { error: 'Chat is available only while the Channel is live.' },
      { status: 409, headers: responseHeaders },
    )
  }

  return {
    channel,
    accountId: account.id,
    profileName: account.name,
  }
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const access = await authorizeChatRequest(context)
  if (access instanceof Response) return access

  try {
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
