import { z } from 'zod'
import { getActiveSession } from '@/lib/auth/session'
import {
  ChatModerationError,
  listChatModerationRecords,
  clearChatModerationRecords,
} from '@/lib/chat-moderation'
import {
  chatModerationFailure,
  chatModerationHeaders as headers,
  readChatModerationBody,
} from '@/lib/chat-moderation-http'

export const dynamic = 'force-dynamic'

async function accountId() {
  const session = await getActiveSession()
  if (!session)
    throw new ChatModerationError('An active account is required.', 401)
  return session.user.id
}

export async function GET(request: Request) {
  try {
    return Response.json(
      listChatModerationRecords(
        await accountId(),
        new URL(request.url).searchParams.get('cursor') ?? undefined,
      ),
      { headers },
    )
  } catch (error) {
    return chatModerationFailure(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const actorId = await accountId()
    const parsed = z
      .object({ confirmed: z.literal(true) })
      .safeParse(await readChatModerationBody(request))
    if (!parsed.success)
      throw new ChatModerationError(
        'Confirm clearing Chat moderation records.',
        400,
      )
    clearChatModerationRecords(actorId)
    return Response.json({ ok: true }, { headers })
  } catch (error) {
    return chatModerationFailure(error)
  }
}
